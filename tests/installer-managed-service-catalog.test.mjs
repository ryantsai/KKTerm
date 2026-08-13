import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = JSON.parse(
  await readFile(new URL("../installer/catalog.v1.json", import.meta.url), "utf8"),
);
const byId = new Map(catalog.recipes.map((recipe) => [recipe.id, recipe]));

function recipe(id) {
  const value = byId.get(id);
  assert.ok(value, `${id} should be present in the installer catalog`);
  return value;
}

function assertSection(id, section) {
  assert.equal(recipe(id).section, section, `${id} should be in ${section}`);
}

test("catalog-owned sections replace the frontend recipe-id allow-list", async () => {
  assert.equal(catalog.schemaVersion, 2);
  assert.ok(
    catalog.recipes.every((entry) => typeof entry.section === "string"),
    "every recipe must explicitly declare a user-facing section or internal",
  );

  const internalIds = catalog.recipes
    .filter((entry) => entry.section === "internal")
    .map((entry) => entry.id)
    .sort();
  assert.deepEqual(internalIds, [
    "github-cli",
    "nvm-windows",
    "poppler",
    "uv",
    "wsl-debian",
    "wsl-ubuntu",
  ]);

  const source = await readFile(
    new URL("../src/modules/installer/sections.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\bids\s*:/, "section metadata must not list recipe ids");
  for (const section of [
    "essentials",
    "aiAgents",
    "aiPlatforms",
    "development",
    "design",
    "productivity",
    "multimedia",
    "windowsPowerUser",
    "remoteAccess",
    "packageManagers",
    "utilities",
  ]) {
    assert.match(source, new RegExp(`id:\\s*"${section}"`));
  }
  assert.ok(
    source.indexOf('id: "packageManagers"') < source.indexOf('id: "utilities"'),
    "Package Managers should be ordered above Utilities",
  );
});

test("existing catalog tools carry their user-facing sections in the catalog", () => {
  for (const [id, section] of [
    ["nssm", "utilities"],
    ["vcxsrv", "utilities"],
    ["oh-my-posh", "utilities"],
    ["coreutils", "utilities"],
    ["ffmpeg", "utilities"],
    ["scrcpy", "utilities"],
    ["bun", "development"],
    ["openflowkit", "design"],
    ["hermes-desktop", "aiAgents"],
    ["winget", "packageManagers"],
    ["chocolatey", "packageManagers"],
    ["keepassxc", "utilities"],
  ]) {
    assertSection(id, section);
  }
});

test("Productivity contains browsers, Acrobat Reader, Notepad++, ShareX, and BentoPDF", () => {
  for (const id of [
    "google-chrome",
    "firefox",
    "acrobat-reader",
    "notepadpp",
    "sharex",
    "bentopdf",
  ]) {
    assertSection(id, "productivity");
  }
});

test("Productivity browsers and PDF reader use verified package providers", () => {
  for (const [id, wingetId, chocolateyId] of [
    ["google-chrome", "Google.Chrome", "googlechrome"],
    ["firefox", "Mozilla.Firefox", "firefox"],
    ["acrobat-reader", "Adobe.Acrobat.Reader.64-bit", "adobereader"],
  ]) {
    const tool = recipe(id);
    assert.deepEqual(tool.provider, { kind: "winget", id: wingetId });
    assert.deepEqual(tool.chocolateyProvider, { kind: "chocolatey", id: chocolateyId });
    assert.ok(tool.options?.includes("provider"));
  }
});

test("Pencil is a Design tool with verified WinGet and Chocolatey sources", () => {
  const pencil = recipe("pencil");
  assert.equal(pencil.section, "design");
  assert.equal(pencil.category, "design");
  assert.deepEqual(pencil.provider, { kind: "winget", id: "Evolus.Pencil" });
  assert.deepEqual(pencil.chocolateyProvider, { kind: "chocolatey", id: "pencil" });
  assert.ok(pencil.options?.includes("provider"));
});

test("Multimedia contains VLC, OBS Studio, and XnView MP", () => {
  const expected = new Map([
    ["vlc", ["VideoLAN.VLC", "vlc"]],
    ["obs-studio", ["OBSProject.OBSStudio", "obs-studio"]],
    ["xnview-mp", ["XnSoft.XnViewMP", "XnViewMP"]],
  ]);

  for (const [id, [wingetId, chocolateyId]] of expected) {
    const entry = recipe(id);
    assert.equal(entry.section, "multimedia");
    assert.equal(entry.category, "multimedia");
    assert.deepEqual(entry.provider, { kind: "winget", id: wingetId });
    assert.deepEqual(entry.chocolateyProvider, {
      kind: "chocolatey",
      id: chocolateyId,
    });
    assert.ok(entry.options?.includes("provider"));
  }
});

test("NSSM, VcXsrv, and Oh My Posh retain their provider contracts", () => {
  assert.deepEqual(recipe("nssm").provider, {
    kind: "winget",
    id: "NSSM.NSSM",
  });
  assert.deepEqual(recipe("vcxsrv").provider, {
    kind: "winget",
    id: "marha.VcXsrv",
  });
  assert.deepEqual(recipe("oh-my-posh").provider, {
    kind: "winget",
    id: "JanDeDobbeleer.OhMyPosh",
  });
});

test("Chocolatey offers winget and official-script bootstrap sources", () => {
  const chocolatey = recipe("chocolatey");
  assert.equal(chocolatey.category, "package-managers");
  assert.deepEqual(chocolatey.provider, {
    kind: "winget",
    id: "Chocolatey.Chocolatey",
  });
  assert.deepEqual(chocolatey.downloadProvider, {
    kind: "downloadInstaller",
    url: "https://community.chocolatey.org/install.ps1",
    fileName: "chocolatey-install.ps1",
  });
  assert.deepEqual(chocolatey.chocolateyProvider, {
    kind: "chocolatey",
    id: "chocolatey",
  });
  assert.ok(chocolatey.needs?.includes("winget"));
  assert.ok(chocolatey.options?.includes("provider"));
});

test("uv is winget-backed but does not request scoped portable installs", () => {
  const uv = recipe("uv");
  assert.deepEqual(uv.provider, {
    kind: "winget",
    id: "astral-sh.uv",
  });
  assert.ok(!uv.options?.includes("scope"));
});

test("PowerShell 7 detection covers versioned ARP display names", () => {
  assert.ok(
    recipe("powershell-7").detection?.displayNamePrefixes?.includes("PowerShell 7"),
  );
});

test("Bun offers WinGet, Chocolatey, and GitHub-release sources", () => {
  const bun = recipe("bun");
  assert.equal(bun.category, "development");
  assert.deepEqual(bun.provider, { kind: "winget", id: "Oven-sh.Bun" });
  assert.deepEqual(bun.chocolateyProvider, { kind: "chocolatey", id: "bun" });
  assert.equal(bun.downloadProvider?.kind, "githubRelease");
  assert.equal(bun.downloadProvider?.repo, "oven-sh/bun");
  assert.ok(bun.options?.includes("provider"));
});

test("curated Chocolatey overlaps expose alternate providers", () => {
  const expected = new Map([
    ["git", "git.install"],
    ["github-cli", "gh"],
    ["vscode", "vscode.install"],
    ["notepadpp", "notepadplusplus.install"],
    ["nssm", "nssm"],
    ["powershell-7", "powershell-core"],
    ["ffmpeg", "ffmpeg"],
    ["blender", "blender"],
    ["keepassxc", "keepassxc"],
    ["pencil", "pencil"],
    ["vlc", "vlc"],
    ["obs-studio", "obs-studio"],
    ["xnview-mp", "XnViewMP"],
  ]);

  for (const [id, packageId] of expected) {
    const entry = recipe(id);
    assert.deepEqual(entry.chocolateyProvider, {
      kind: "chocolatey",
      id: packageId,
    });
    assert.ok(entry.options?.includes("provider"));
  }
});

test("Coreutils retains winget and direct-download providers", () => {
  const coreutils = recipe("coreutils");
  assert.equal(coreutils.category, "cli");
  assert.deepEqual(coreutils.provider, {
    kind: "winget",
    id: "Microsoft.Coreutils",
  });
  assert.equal(coreutils.downloadProvider?.kind, "downloadInstaller");
  assert.match(coreutils.downloadProvider?.url, /github\.com\/microsoft\/coreutils/);
  assert.ok(coreutils.options?.includes("provider"));
});

test("BentoPDF and OpenFlowKit retain managed web-app providers", () => {
  const bentopdf = recipe("bentopdf");
  assert.ok(bentopdf.needs?.includes("node-bundle"));
  assert.deepEqual(bentopdf.provider, {
    kind: "npm",
    pkg: "github:alam00000/bentopdf",
  });

  const openflowkit = recipe("openflowkit");
  assert.ok(openflowkit.needs?.includes("node-bundle"));
  assert.deepEqual(openflowkit.provider, {
    kind: "npm",
    pkg: "github:Vrun-design/openflowkit",
  });
});

test("Draw.IO, Krita, and Inkscape retain their Design providers", () => {
  const expected = new Map([
    ["drawio", "JGraph.Draw"],
    ["krita", "KDE.Krita"],
    ["inkscape", "Inkscape.Inkscape"],
  ]);

  for (const [id, wingetId] of expected) {
    const entry = recipe(id);
    assert.equal(entry.section, "design");
    assert.deepEqual(entry.provider, { kind: "winget", id: wingetId });
    assert.ok(entry.options?.includes("provider"));
  }
});

test("Hermes Desktop retains its direct installer source", () => {
  const hermes = recipe("hermes-desktop");
  assert.deepEqual(hermes.provider, {
    kind: "downloadInstaller",
    url: "https://hermes-assets.nousresearch.com/Hermes-Setup.exe",
    fileName: "Hermes-Setup.exe",
  });
});

test("Hermes Agent uses the official Windows bootstrapper", () => {
  const hermes = recipe("hermes-agent");
  assert.equal(hermes.section, "aiAgents");
  assert.deepEqual(hermes.needs, undefined);
  assert.deepEqual(hermes.provider, {
    kind: "downloadInstaller",
    url: "https://hermes-agent.nousresearch.com/install.ps1",
    fileName: "hermes-agent-install.ps1",
  });
  assert.deepEqual(hermes.options, []);
});

test("Pi and Oh My Pi expose their current Windows install methods", () => {
  const pi = recipe("pi");
  assert.equal(pi.section, "aiAgents");
  assert.deepEqual(pi.needs, ["node-bundle"]);
  assert.deepEqual(pi.provider, {
    kind: "npm",
    pkg: "@earendil-works/pi-coding-agent",
  });
  assert.ok(pi.options?.includes("version"));

  const ohMyPi = recipe("oh-my-pi");
  assert.equal(ohMyPi.section, "aiAgents");
  assert.deepEqual(ohMyPi.needs, undefined);
  assert.deepEqual(ohMyPi.provider, {
    kind: "downloadInstaller",
    url: "https://omp.sh/install.ps1",
    fileName: "oh-my-pi-install.ps1",
  });
  assert.deepEqual(ohMyPi.options, []);
});

test("Kimi Code and Grok Build expose every verified Windows provider", () => {
  const kimi = recipe("kimi-code-cli");
  assert.equal(kimi.section, "aiAgents");
  assert.deepEqual(kimi.needs, ["winget", "git"]);
  assert.deepEqual(kimi.provider, {
    kind: "winget",
    id: "MoonshotAI.KimiCodeCLI",
  });
  assert.deepEqual(kimi.downloadProvider, {
    kind: "downloadInstaller",
    url: "https://code.kimi.com/kimi-code/install.ps1",
    fileName: "kimi-code-install.ps1",
  });
  assert.deepEqual(kimi.npmProvider, {
    kind: "npm",
    pkg: "@moonshot-ai/kimi-code",
  });
  assert.ok(kimi.options?.includes("provider"));
  assert.ok(kimi.options?.includes("version"));

  const grok = recipe("grok-build");
  assert.equal(grok.section, "aiAgents");
  assert.deepEqual(grok.needs, ["winget"]);
  assert.deepEqual(grok.provider, {
    kind: "winget",
    id: "xAI.GrokBuild",
  });
  assert.deepEqual(grok.downloadProvider, {
    kind: "downloadInstaller",
    url: "https://x.ai/cli/install.ps1",
    fileName: "grok-build-install.ps1",
  });
  assert.equal(grok.npmProvider, undefined);
  assert.ok(grok.options?.includes("provider"));
  assert.ok(grok.options?.includes("version"));
});

test("Cursor Agent CLI uses the official native Windows installer", () => {
  const cursor = recipe("cursor-cli");
  assert.equal(cursor.section, "aiAgents");
  assert.deepEqual(cursor.needs, undefined);
  assert.deepEqual(cursor.provider, {
    kind: "downloadInstaller",
    url: "https://cursor.com/install?win32=true",
    fileName: "cursor-agent-install.ps1",
  });
  assert.deepEqual(cursor.options, []);
});

test("fixed direct-download fallbacks point at current release assets", () => {
  const expected = new Map([
    ["git", "Git-2.55.0.4-64-bit.exe"],
    ["github-cli", "gh_2.97.0_windows_amd64.msi"],
    ["notepadpp", "npp.8.9.7.Installer.x64.exe"],
    ["bruno", "bruno_4.0.0_x64_win.exe"],
    ["coreutils", "coreutils-2026.6.16-x64.exe"],
    ["powertoys", "PowerToysUserSetup-0.100.2-x64.exe"],
    ["powershell-7", "PowerShell-7.6.4-win-x64.msi"],
    ["sharex", "ShareX-21.0.0-setup-x64.exe"],
    ["drawio", "draw.io-31.1.8-windows-installer.exe"],
  ]);

  for (const [id, fileName] of expected) {
    const provider = recipe(id).downloadProvider;
    assert.equal(provider?.kind, "downloadInstaller");
    assert.equal(provider?.fileName, fileName, `${id} should use its current asset`);
    assert.match(provider?.url ?? "", new RegExp(fileName.replaceAll(".", "\\.")));
  }
  assert.equal(
    recipe("cursor").downloadProvider?.url,
    "https://api2.cursor.sh/updates/download/golden/win32-x64-user/cursor/latest",
  );
});

test("Claude Desktop detection covers the official Windows MSIX package", () => {
  assert.ok(
    recipe("claude-desktop").detection?.appxPackageFamilyNames?.includes(
      "Claude_pzs8sxrjxfjjc",
    ),
  );
});

test("managed server apps depend on NSSM for service registration", () => {
  for (const id of ["n8n", "ollama"]) {
    assert.ok(recipe(id).needs?.includes("nssm"));
  }
});

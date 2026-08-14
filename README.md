<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>One native desktop window for terminals, SSH, SFTP, RDP/VNC, and a dashboard — plus an AI that builds your own little tools on request.</strong>
</p>

<p align="center">
  <em>Because your taskbar shouldn't look like a Vegas slot machine.</em>
</p>

<p align="center">
  <sub>Named after <strong>乖乖 (Kuāi Kuāi)</strong>, the green coconut snack Taiwanese sysadmins place on servers to keep them well-behaved. We hope this app earns its place on the rack.</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">Download the latest release</a></strong>
</p>

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm/stargazers">
    <img src="https://img.shields.io/github/stars/ryantsai/KKTerm?style=for-the-badge&logo=github&color=ffd33d" alt="GitHub stars" />
  </a>
  <a href="https://github.com/ryantsai/KKTerm/network/members">
    <img src="https://img.shields.io/github/forks/ryantsai/KKTerm?style=for-the-badge&logo=github&color=8a63d2" alt="GitHub forks" />
  </a>
  <a href="https://github.com/ryantsai/KKTerm/releases">
    <img src="https://img.shields.io/github/downloads/ryantsai/KKTerm/total?style=for-the-badge&logo=github&color=0969da" alt="GitHub downloads" />
  </a>
  <a href="https://github.com/ryantsai/KKTerm/issues">
    <img src="https://img.shields.io/github/issues/ryantsai/KKTerm?style=for-the-badge&logo=github&color=2ea043" alt="Open issues" />
  </a>
  <a href="https://github.com/ryantsai/KKTerm/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/ryantsai/KKTerm?style=for-the-badge&color=blue" alt="MIT License" />
  </a>
  <a href="https://github.com/sponsors/ryantsai">
    <img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor KKTerm on GitHub" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Cross-platform desktop" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local-first" />
  <br />
  <sub>
    <strong>English</strong> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.fr.md">Français</a> ·
    <a href="README.de.md">Deutsch</a> ·
    <a href="README.es.md">Español</a> ·
    <a href="README.es-MX.md">Español (MX)</a> ·
    <a href="README.it.md">Italiano</a> ·
    <a href="README.pt-BR.md">Português (BR)</a> ·
    <a href="README.th.md">ไทย</a> ·
    <a href="README.id.md">Bahasa Indonesia</a> ·
    <a href="README.vi.md">Tiếng Việt</a>
  </sub>
</p>

---

## The 45-Second Pitch

KKTerm brings local terminals, SSH/SFTP, FTP/FTPS, Telnet, serial, RDP/VNC, embedded web pages, local files, and documents into one desktop workspace. Tabs can mix different Pane types, so the terminal, file browser, and remote screen for one job stay together.

It runs on Windows, macOS, and Linux with local-first storage and no telemetry. Approval-gated AI, customizable Dashboard widgets, Workspaces, IT Ops, and the Windows Install Helper are built in.

---

## Why "KKTerm"?

Walk into any Taiwanese data center and look at the top of the racks. Past TSMC fabs, Taipei Metro control rooms, Cathay Bank server halls, Chunghwa Telecom switching gear — you will spot a small green bag of 乖乖 (Kuāi Kuāi), a coconut-flavored corn snack from the 1960s.

**KKTerm** is **Kuai Kuai Term** — an admin workspace that aspires to the same job as the snack: to sit quietly next to your important machines and help them behave. Local-first. No telemetry. Approval-gated AI. The boring, dependable kind of software.

We have not yet been able to ship an actual bag of Kuai Kuai with the installer. That's a v2 item.

---

## See It Move

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>(Demo GIF. A picture is worth a thousand bullet points, and we ran out of bullet points.)</em></sub></p>

---

## One Window, Every Connection

| You wanted to… | KKTerm does it |
| --- | --- |
| Open a local PowerShell / cmd / WSL shell | Local terminals, side by side |
| SSH into a server | SSH with keys, agent, passwords, jump hosts, and port forwarding |
| Browse files on that server | SFTP from the SSH connection — dual-pane, drag to transfer |
| FTP to a NAS from 2012 | FTP / FTPS in the same file browser |
| Telnet to ancient gear | Yes, Telnet's in there too |
| Talk to a serial port | Serial connections — pick a COM port and baud |
| Remote into a Windows box | The real Microsoft Remote Desktop, built right in |
| VNC into a Pi | VNC, rendered straight into the workspace |
| Open the router's web UI | An embedded browser tab with saved logins |
| Browse your own disk | A local File Explorer pane, same dual-pane shell as SFTP |
| Open a log, CSV, image, or PDF | A built-in Document viewer with a real tail-follow log mode |
| Watch CPU on the host | A live status bar and a dashboard you can build on |

Same app. Same window. Same hotkeys. Same hopefully-not-eye-bleeding theme.

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="A single Tab holding SSH, SFTP, and an embedded web UI side by side" width="720" />
</p>

---

## Why People Keep It Open All Day

### Tiny download, instant launch

KKTerm is built to feel like a utility, not a platform. Current desktop builds land under 20 MB, install quickly, and launch fast enough that opening your admin workspace does not feel like starting a second operating system.

### Multi-pane grids, mixed however you work

A Tab can hold a grid of Panes, and those Panes do not have to be the same kind. Put SSH next to SFTP, a local PowerShell below an RDP Session, VNC beside the router's web UI, or a file browser next to the terminal that is moving the files.

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="A Tab split into four panes of different connection kinds" width="720" />
</p>

### An AI assistant that commands your terminals for you

Most "AI in your terminal" demos stop at chat. KKTerm's assistant works *inside* your session: you hand it context from whatever is already on screen, and it acts on the boxes you're connected to — with a human in the approval loop.

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="The AI Assistant panel with the tool-access and approval-mode toggles" width="720" />
</p>

### A Dashboard that doesn't pretend to be Grafana

The Dashboard is a drag-and-resize grid of widgets. It's not for petabyte observability — it's for "I want a button to launch my five favorite apps and a panel showing my SSH host's uptime, *next to* my chat."

Dashboard Views can use 47 app-owned animated backgrounds: `fuji`, `aurora`, `halftone`, `clouds`, `ocean`, `mistySea`, `maelstrom`, `waters`, `raindrops`, `rainyWindow`, `frostedWindow`, `snow`, `sakura`, `fireflies`, `bubbles`, `aquarium`, `jellyfish`, `lighthouse`, `balloons`, `ricefield`, `lanterns`, `starfield`, `nebula`, `orbitals`, `embers`, `lava`, `ink`, `dunes`, `savanna`, `matrix`, `topo`, `synthwave`, `circuit`, `crystals`, `cyberpunk`, `taipei101`, `thunderstorm`, `confetti`, `particleCursor`, `heroGeometric`, `ditherPrismHero`, `webglLiquid`, `silkAurora`, `closingPlasma`, `animatedGradient`, `prismGradient`, and `liquidChrome`. The newest eight are procedural WebGL scenes. The same background picker is available for terminal Connections, the Document viewer, and IT Ops drill views; hidden or off-screen scenes stop rendering and release their WebGL resources.

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="A dashboard grid of AI-created widgets" width="720" />
</p>

### IT Ops for sites, hosts, and repeatable work

The **IT Ops** Module groups Connections into Sites, maps Server Rooms and Racks, inventories Hosts, and runs reusable Tasks across selected machines. Batch Runs preserve per-host results, while Automations turn triggers and conditions into notifications, webhooks, or scheduled Tasks.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="The IT Ops Server Room elevations view showing six populated equipment racks and host health indicators" width="720" />
</p>

### Capture, organize, and annotate screenshots

The **Screenshots** Module captures a region, window, or full desktop to a local library, the clipboard, or both. Sort and group captures, resize or convert them in batches, and open any image in the built-in editor for cropping, pencil marks, arrows, shapes, text, and mosaic redaction. Global shortcuts and tray actions keep capture one keystroke away.

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="The Screenshots Module with capture controls and a thumbnail library" width="720" />
</p>

### Keep your AI agents alive

This is the second feature people fall in love with. KKTerm's SSH terminals can drop you straight into a **named tmux session** on the remote host that survives reconnect.

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="An SSH pane re-attaching to a named tmux session after a reconnect" width="720" />
</p>

### Keep your worlds apart with Workspaces

The home lab, the day job, and that one client's servers do not belong in the same list. **Workspaces** are named, isolated containers of Connections you switch between from the Activity Rail. Switching re-scopes the Connection Tree only — your open Sessions, Dashboard, and Settings stay put — so changing context costs one click, not a relaunch.

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="The workspace switcher in the activity rail" width="720" />
</p>

### Dress it up: color themes

Backgrounds are the fun part; **color themes** are the part you actually stare at all day. KKTerm ships **twenty-six** color schemes that restyle the whole app chrome — Activity Rail, Connection Tree, tabs, dialogs — with a live mini-preview of each under Settings ▸ Appearance.

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="The color-scheme grid in Settings with live previews" width="720" />
</p>

### Install Helper (Windows only)

Setting up a fresh Windows box for dev work is usually ten browser tabs and a lot of "next, next, finish." The **Install Helper** is a built-in catalog that finds, installs, updates, and uninstalls the tools you'd otherwise chase by hand — without leaving KKTerm.

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="The Install Helper catalog with installed and available tools" width="720" />
</p>

---

## What KKTerm Is Not

A short list, because honesty earns trust:

- **Not a cloud product.** No sync, no team accounts, no SaaS tier. If you ever see a "Sign in to KKTerm" dialog, something has gone catastrophically wrong.
- **Not pretending every OS is identical.** KKTerm ships Windows, macOS, and Linux builds, but platform-specific features stay honest: Windows has the native RDP ActiveX path and Install Helper catalog, while macOS and Linux use the portable paths available on those systems.
- **Not an autonomous AI agent.** The assistant proposes; the human disposes. `Allow All` is a choice you make, not a default.
- **Not a Grafana / Datadog replacement.** The Dashboard is for personal control surfaces, not 10k-host observability.
- **Not a Kubernetes IDE.** It is a terminal-first admin workspace. Please don't ask it to render a Helm chart.

If any of those *was* a dealbreaker — fair enough, we'll see you in v2.

---

## Get KKTerm

**[Download the latest release](https://github.com/ryantsai/KKTerm/releases/latest)** for your platform and run it. Windows offers the normal setup executable and x64/ARM64 portable ZIPs. For portable use, extract the whole ZIP to a writable local folder or removable drive and run `KKTerm.exe`; do not run it inside the ZIP or from a network share. An installed Windows copy can alternatively create a portable folder with selected non-secret settings from Settings → General → Settings data. The portable folder contains its own `data` directory, but Install Helper tools and managed web apps remain installed on the current computer.

Windows packages are currently **unsigned** — release signing is on the roadmap, so until then your antivirus may give you a stern look. Verify the adjacent `.sha256` file before running either package type.

Want to build from source or contribute? Everything you need is in [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Roadmap (the short version)

- Cross-platform release polish
- Release signing polish
- More file-transfer power (resume, folder sync, archive/extract)
- Richer remote-desktop clipboard and device sharing
- More built-in dashboard widgets
- More IT Ops automation functionality

Full and frequently-updated version: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Sponsorship

KKTerm is developed and maintained by one person. If you find it useful, any support is welcome and helps me keep improving it.

[![Sponsor KKTerm on GitHub](https://img.shields.io/badge/Sponsor%20on%20GitHub-%E2%9D%A4-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ryantsai)

---

## Contributing

We would love a hand. Genuinely. Even small things matter.

Full setup, project layout, and the PR checklist live in [`CONTRIBUTING.md`](CONTRIBUTING.md). Looking for an entry point? Filter open issues by [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) or [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).

---

## Project Docs

- [Product context](CONTEXT.md) — the domain language you should match
- [Architecture](docs/ARCHITECTURE.md) — module map, where to put new code
- [User manual](docs/manual/INDEX.md) — feature-by-feature walkthrough
- [Roadmap](docs/ROADMAP.md)
- [Dashboard architecture](docs/DASHBOARD.md)
- [Built-in MCP server](docs/MCP.md)
- [AI provider guide](docs/AI_PROVIDERS.md)

---

## License

MIT. See [LICENSE](LICENSE). Use it, fork it, ship it, put it in a homelab nobody else can find — that's the deal.

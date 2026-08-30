<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>One cross-platform desktop workspace for terminals, SSH/SFTP, RDP/VNC, files, web pages, IT Ops, and an approval-gated AI assistant.</strong>
</p>

<p align="center">
  <em>Because your taskbar shouldn't look like a Vegas slot machine.</em>
</p>

<p align="center">
  <sub>Named after <strong>乖乖 (Kuāi Kuāi)</strong>, the green coconut snack Taiwanese sysadmins place on servers to keep them well-behaved.</sub>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="MIT License with Commons Clause" />
  </a>
  <a href="https://buymeacoffee.com/ryantsai">
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="Buy me a coffee" />
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

## Why “KKTerm”?

KKTerm means **Kuai Kuai Term** — a nod to the green 乖乖 snack Taiwanese sysadmins place on servers, hoping important machines stay quiet, reliable, and well-behaved.

## One window, every connection

KKTerm brings local shells, SSH/SFTP, FTP/FTPS, Telnet, serial, RDP/VNC, URL Connections, local File Explorer, and the Document viewer into one desktop workspace. Tabs can mix Pane types, so a terminal, file browser, web UI, and remote screen can stay together.

| Need | KKTerm |
| --- | --- |
| Local shells | PowerShell, cmd, and WSL |
| Remote access | SSH, Telnet, serial, RDP, and VNC |
| Files and web | SFTP, FTP/FTPS, local files, and embedded URL Connections |
| Documents | Logs with tail-follow, text, CSV, images, and PDFs |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="Mixed SSH, SFTP, terminal, URL, and RDP Panes in one KKTerm Tab" width="720" />
</p>

## Built for the work around the terminal

- **Workspace** — mixed Tabs and Panes, named Workspaces, tmux reattach, Connection Notes, Git Browser, and File Compare.
- **AI Assistant** — approval-gated tools for Sessions, Dashboard, IT Ops, and Custom Modules, plus attachments, send-to-terminal, MCP, and reusable Assistant Skills.
- **Dashboard** — switchable Views with draggable, resizable built-in or AI-created widgets, App Launcher, live Connection panels, Notes, usage meters, and utility tools.
- **IT Ops** — Sites with Server Room and Rack topology (elevation, floor plan, and 2.5D views), Host inventory and connectivity scans, reusable Script and Playbook Tasks, Batch Runs over SSH/WinRM/PsExec, IPAM, VLANs, Network Maps, run history, and PDF/CSV exports.
- **Screenshots** — capture a region, window, or full desktop; save to a local library or clipboard; batch resize/convert; and annotate with crop, shapes, text, and mosaic tools.
- **Custom Modules** — install isolated `.kkmod` packages from Settings, review declared permissions, add rail destinations, and manage updates, rollback, storage, and uninstall. The repository includes integrations such as Excalidraw, BentoPDF, OpenFlowKit, and TiddlyWiki.
- **Install Helper (Windows)** — discover, install, update, and uninstall tools, including supported local web apps and services.

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="KKTerm IT Ops Server Room rack elevations with device health indicators" width="720" />
</p>

## Make it yours

Dashboard Views, terminal Connections, the Document viewer, and IT Ops drill views share one background picker. Choose from solid and gradient presets, local images and videos, or **84 built-in dynamic backgrounds** ranging from oceans and weather to WebGL scenes, space, network graphics, and abstract motion. Hidden or off-screen scenes pause and release their rendering resources. Color themes, terminal appearance settings, custom fonts, and per-Connection backgrounds round out the workspace.

<details>
  <summary>Built-in dynamic background IDs</summary>

  `fuji`, `aurora`, `halftone`, `clouds`, `ocean`, `mistySea`, `maelstrom`, `sunGlitter`, `whitecaps`, `waveField`, `openOceanBlue`, `tropicalGreen`, `waters`, `raindrops`, `rainywindow`, `frostedWindow`, `snow`, `sakura`, `fireflies`, `bubbles`, `aquarium`, `jellyfish`, `lighthouse`, `balloons`, `ricefield`, `lanterns`, `heroGeometric`, `webglLiquid`, `silkAurora`, `animatedGradient`, `starfield`, `nebula`, `orbitals`, `ditherPrismHero`, `closingPlasma`, `prismGradient`, `embers`, `lava`, `ink`, `dunes`, `savanna`, `matrix`, `topo`, `synthwave`, `circuit`, `crystals`, `cyberpunk`, `taipei101`, `thunderstorm`, `confetti`, `particleCursor`, `liquidChrome`, `windowRain`, `submergedSnellOcean`, `spectralCascadeOcean`, `blackHole`, `predictiveArc`, `liquidForm`, `energyOrb`, `noiseFlow`, `streamConvergence`, `bellField`, `flowField`, `condensation`, `generativeTree`, `ribbonField`, `particleOrb`, `cloudField`, `voidField`, `recursiveErosion`, `quanteraTradingBackground`, `halftoneFlow`, `constellationField`, `particleDrift`, `particleNetwork`, `amberHalftone`, `matrixField`, `gatewayFlow`, `connectivityGraph`, `interfaceLines`, `defenseLines`, `topoField`, `sylvaLivingWorld`, `templeNight`.
</details>

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="KKTerm's dynamic background picker" width="720" />
</p>

## See it in action

<p align="center">
  <img src="docs/assets/demo.gif" alt="KKTerm demo" width="720" />
</p>

## Get KKTerm

Download the [latest release](https://github.com/ryantsai/KKTerm/releases/latest) for Windows, macOS, or Linux. Windows provides a setup executable and x64/ARM64 portable ZIPs; extract a portable ZIP to a writable local folder or removable drive, not a network share. Verify the adjacent `.sha256` file before running a package.

To build from source, start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Contribute, support, and docs

Contributions and bug reports are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md), then browse the [operation manual](docs/manual/INDEX.md), [architecture](docs/ARCHITECTURE.md), [Dashboard guide](docs/DASHBOARD.md), [IT Ops guide](docs/ITOPS.md), and [Custom Module host API](docs/KKMOD_HOST_API_V2.md).

If KKTerm is useful, you can [buy me a coffee](https://buymeacoffee.com/ryantsai).

## License

KKTerm's source is MIT with the Commons Clause. Vendored crates, Custom Modules, fonts, and icon packs remain under their own licenses; see [`LICENSE`](LICENSE) and the notices in their directories.

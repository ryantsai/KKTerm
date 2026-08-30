<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>一个跨平台桌面工作区，整合终端、SSH/SFTP、RDP/VNC、文件、网页、IT Ops 和需要审批的 AI 助手。</strong>
</p>

<p align="center">
  <em>因为你的任务栏不该看起来像拉斯维加斯的老虎机。</em>
</p>

<p align="center">
  <sub>名称来自 <strong>乖乖</strong>，台湾系统管理员放在服务器上的绿色椰子味玉米点心，希望它们乖乖工作。</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">下载最新版 KKTerm</a></strong>
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
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-%E2%98%95-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black" alt="请我喝杯咖啡" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="跨平台桌面应用" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="本地优先，无遥测" />
  <br />
  <sub>
    <a href="README.md">English</a> ·
    <a href="README.zh-TW.md">繁體中文</a> ·
    <strong>简体中文</strong> ·
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

## 为什么叫「KKTerm」？

KKTerm 就是 **Kuai Kuai Term**——名字取自台湾系统管理员放在服务器上的绿色乖乖，希望重要的机器安静、可靠，也能乖乖工作。

## 一个窗口，所有连接

KKTerm 将本地 Shell、SSH/SFTP、FTP/FTPS、Telnet、串口、RDP/VNC、URL 连接、本地文件浏览器和文档查看器集中在一个桌面工作区中。Tab 可以混合不同类型的 Pane，让同一项工作的终端、文件浏览器、网页界面和远程画面待在一起。

| 用途 | KKTerm |
| --- | --- |
| 本地 Shell | PowerShell、cmd 和 WSL |
| 远程访问 | SSH、Telnet、串口、RDP 和 VNC |
| 文件与网页 | SFTP、FTP/FTPS、本地文件和内嵌 URL 连接 |
| 文档 | 支持持续追踪的日志、文本、CSV、图片和 PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="在同一个 KKTerm Tab 中混合 SSH、SFTP、终端、URL 和 RDP Pane" width="720" />
</p>

## 为终端周边的工作而生

- **Workspace** — 混合 Tab 与 Pane、命名 Workspace、tmux 重新连接、Connection Notes、Git Browser 和 File Compare。
- **AI 助手** — 需要用户审批的 Session、Dashboard、IT Ops 与 Custom Module 工具，还支持附件、发送到终端、MCP 和可复用的 Assistant Skills。
- **Dashboard** — 可切换的 View，以及可以拖动、调整大小的内置或 AI 创建 Widget；包含 App Launcher、实时 Connection 面板、Notes、用量计和实用工具。
- **IT Ops** — Site 的 Server Room 与 Rack 拓扑（elevation、floor plan 和 2.5D View）、Host 清单与连通性扫描、可复用的 Script/Playbook Task、通过 SSH/WinRM/PsExec 执行的 Batch Run、IPAM、VLAN、Network Map、运行历史以及 PDF/CSV 导出。
- **Screenshots** — 截取区域、窗口或整个桌面，保存到本地图像库或剪贴板，批量调整大小／转换，并用裁剪、图形、文字和马赛克工具标注。
- **Custom Modules** — 从 Settings 安装隔离的 `.kkmod` 包，查看声明的权限，将它们添加为 Activity Rail 目的地，并管理更新、回滚、存储和卸载。仓库包含 Excalidraw、BentoPDF、OpenFlowKit 和 TiddlyWiki 等集成。
- **Install Helper（Windows）** — 无需离开 KKTerm，即可发现、安装、更新和卸载工具，以及管理受支持的本地 Web 应用和服务。

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="KKTerm IT Ops Server Room 的 Rack elevation 和设备健康状态" width="720" />
</p>

## 打造自己的工作区

Dashboard View、终端 Connection、文档查看器和 IT Ops drill view 共用一个背景选择器。你可以选择纯色和渐变预设、本地图片和视频，或 **84 个内置动态背景**：从海洋、天气，到 WebGL 场景、太空、网络图形和抽象动画。隐藏或完全离开画面的场景会暂停并释放渲染资源。色彩主题、终端外观、自定义字体和每个 Connection 的背景，让工作区更符合你的习惯。

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="KKTerm 的动态背景选择器" width="720" />
</p>

## 实际看看

<p align="center">
  <img src="docs/assets/demo.gif" alt="KKTerm 演示" width="720" />
</p>

## 获取 KKTerm

从[最新版本](https://github.com/ryantsai/KKTerm/releases/latest)下载 Windows、macOS 或 Linux 版本。Windows 提供安装程序和 x64／ARM64 便携 ZIP；请将便携 ZIP 解压到可写入的本地文件夹或可移动磁盘，不要从网络共享位置运行。运行前请核对旁边的 `.sha256` 文件。

如果要从源代码构建，请先阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 参与、支持与文档

欢迎贡献代码和报告问题。请参阅 [`CONTRIBUTING.md`](CONTRIBUTING.md)，再浏览[操作手册](docs/manual/INDEX.md)、[架构文档](docs/ARCHITECTURE.md)、[Dashboard 指南](docs/DASHBOARD.md)、[IT Ops 指南](docs/ITOPS.md) 和 [Custom Module Host API](docs/KKMOD_HOST_API_V2.md)。

如果 KKTerm 对你有帮助，也可以[请我喝杯咖啡](https://buymeacoffee.com/ryantsai)。

## 许可证

KKTerm 源代码采用 MIT 搭配 Commons Clause。Vendored crate、Custom Module、字体和图标包仍受各自许可证约束，详见 [`LICENSE`](LICENSE) 及其目录中的许可和通知文件。

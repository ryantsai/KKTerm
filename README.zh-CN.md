<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>一扇 Windows 原生窗口，搞定终端、SSH、SFTP、RDP/VNC 和 Dashboard — 还附一个能照你要求打造专属小工具的 AI。</strong>
</p>

<p align="center">
  <em>因为你的任务栏不该长得像拉斯维加斯的老虎机。</em>
</p>

<p align="center">
  <sub>名称来自 <strong>乖乖</strong>，那包台湾系统管理员放在服务器上、希望它好好工作的绿色椰子味玉米点心。希望这个 app 也能争取到它在机架上的一席之地。</sub>
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
    <img src="https://img.shields.io/github/license/ryantsai/KKTerm?style=for-the-badge&color=blue" alt="MIT License" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="Cross-platform desktop" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="Local-first" />
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

## 45 秒简报

KKTerm 把本地终端、SSH/SFTP、FTP/FTPS、Telnet、串口、RDP/VNC、嵌入式网页、本地文件和文档集中在一个桌面工作区中。一个 Tab 可以混合不同类型的 Pane，让同一项工作的终端、文件浏览器和远程画面待在一起。

它支持 Windows、macOS 和 Linux，数据存储在本地，不使用遥测。需要用户批准的 AI、可定制 Dashboard widget、Workspace、IT Ops 和 Windows Install Helper 均已内置。

---

## 为什么叫「KKTerm」？

走进任何一座台湾的数据中心，抬头看机架顶端。从台积电晶圆厂、台北捷运控制室、国泰银行的服务器机房、中华电信的交换机房 — 你都会看到一小包绿色的 **乖乖**，那是 1960 年代就有的椰子味玉米点心。

**KKTerm** 就是 **Kuai Kuai Term** — 一个跟那包点心一样有抱负的管理工作区：安静地坐在你那些重要机器旁边，帮它们乖一点。本地优先。零遥测。AI 全程要审批。那种无聊但可靠的软件。

我们目前还没办法在 installer 里塞一包真正的乖乖。那是 v2 的待办事项。

---

## 亲眼看看

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>（demo GIF。一张图胜过一千个要点，而我们要点也快用完了。）</em></sub></p>

---

## 一扇窗口，所有连接

| 你想要… | KKTerm 帮你做到 |
| --- | --- |
| 开一个本机 PowerShell / cmd / WSL shell | 本机终端，并排摆着 |
| SSH 进服务器 | SSH 支持密钥、agent、密码、跳板主机与 port forwarding |
| 浏览那台服务器上的文件 | 从 SSH 连接直接开 SFTP — 双窗格、拖拽就能传 |
| FTP 到 2012 年的 NAS | FTP / FTPS，同一个文件浏览器 |
| Telnet 连上古董设备 | 对，Telnet 也在里面 |
| 跟串口对话 | Serial 连接 — 选个 COM port 和波特率就好 |
| 远程进一台 Windows 机器 | 内建货真价实的微软远程桌面 |
| VNC 进一台 Pi | VNC，直接画进工作区 |
| 开路由器的网页后台 | 内嵌浏览器标签页，还会帮你带入登录信息 |
| 翻自己的本机磁盘 | 一个本机 File Explorer pane，和 SFTP 同一套双窗格外壳 |
| 开一份 log、CSV、图片或 PDF | 内建 Document 查看器，还有真正能 tail 跟随的 log 模式 |
| 看主机的 CPU | 实时状态栏，加上一个你可以自己堆东西的 Dashboard |

同一个 app。同一扇窗口。同一组快捷键。同一套但愿不会让你眼睛流血的主题。

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="同一个 Tab 并排放着 SSH、SFTP 和内嵌 Web UI" width="720" />
</p>

---

## 为什么大家整天开着它

### 下载很小，启动像闪电

KKTerm 做得像一个工具，而不是一整套平台。现在的桌面版不到 20 MB，安装很快，启动也快到不像是在开第二套操作系统。

### 多窗格网格，想怎么混都行

一个 Tab 可以放一组 Pane 网格，而且这些 Pane 不必是同一种。SSH 旁边放 SFTP、RDP Session 下面放本地 PowerShell、VNC 旁边放路由器 Web UI，或把文件浏览器放在正在搬文件的终端旁边。

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="一个 Tab 切成四个不同连接种类的 pane" width="720" />
</p>

### 一个会帮你操控终端的 AI 助理

大多数「终端里的 AI」demo 都停在聊天。KKTerm 的助理是在你的 session *里面*运作：你把画面上现有的内容当 context 交给它，它就对你连着的那些机器动手 — 而且全程有人类在审批回路里。

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="AI 助理面板，含工具访问与审批模式开关" width="720" />
</p>

### 一个不假装自己是 Grafana 的 Dashboard

Dashboard 是一个可拖拽、可缩放的 widget 网格。它不是给你做 PB 级观测用的 — 它是给「我想要一个按钮启动我最爱的五个 app，旁边一个面板显示我 SSH 主机的 uptime，*再旁边*就是我的聊天窗口」用的。

Dashboard View 可使用 45 款 KKTerm 内置动态背景；最新加入的八款 WebGL 程序化场景是 `heroGeometric`、`ditherPrismHero`、`webglLiquid`、`silkAurora`、`closingPlasma`、`animatedGradient`、`prismGradient` 和 `liquidChrome`。终端 Connection、Document viewer 和 IT Ops 下钻视图也共用同一个背景选择器；场景隐藏或移出屏幕后会停止渲染并释放 WebGL 资源。

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="一整片 AI 打造的 Dashboard widget" width="720" />
</p>

### 面向站点、主机和重复工作的 IT Ops

**IT Ops** 模块将连接组织为站点，呈现服务器机房与机架，维护主机清单，并在所选机器上运行可复用任务。批量运行会保留每台主机的结果；自动化则把触发器和条件连接到通知、Webhook 或任务。

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="IT Ops 服务器机房立面视图，显示六个已部署设备的机架和主机状态指示器" width="720" />
</p>

### 截取、整理和标注屏幕截图

**屏幕截图** 模块可将选定区域、窗口或整个桌面截取到本地图库、剪贴板，或同时保存到两者。你可以对截图进行排序和分组，批量调整尺寸或转换格式，还能在内置编辑器中裁剪、手绘、添加箭头、图形和文字，或用马赛克遮挡内容。全局快捷键和系统托盘操作让截图始终一键可用。

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="屏幕截图模块，显示截图控件和缩略图库" width="720" />
</p>

### 让你的 AI agent 活着

这是大家爱上的第二个功能。KKTerm 的 SSH 终端可以直接把你丢进远程主机上一个**命名的 tmux session**，而且它扛得过重连。

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="SSH pane 在重连后重新 attach 回命名的 tmux session" width="720" />
</p>

### 用工作区把不同世界分开

homelab、正职工作、还有那个客户的服务器，本来就不该挤在同一份列表里。**工作区（Workspaces）**是命名、彼此隔离的 Connection 容器，你可以从 Activity Rail 一键切换。切换只会重新框定连接树 — 你打开的 Sessions、Dashboard 和设置都原地不动 — 所以换情境只花一下点击，而不是重开 app。

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="Activity Rail 上的工作区切换器" width="720" />
</p>

### 换上你喜欢的配色（色彩主题）

背景是好玩的部分；**色彩主题**才是你一整天真正盯着看的东西。KKTerm 内建**二十六种**色彩配色，会重新妆点整个 app 外壳 — Activity Rail、连接树、标签页、对话框 — 在设置 ▸ 外观里每一种都有实时迷你预览。

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="设置里的色彩配色网格，附实时预览" width="720" />
</p>

### Install Helper（仅限 Windows）

把一台全新的 Windows 机器设置成开发环境，通常等于十个浏览器标签页加上一堆「下一步、下一步、完成」。**Install Helper** 是一个内建的工具目录，帮你找到、安装、更新并卸载那些你本来得手动追的工具 — 全程不用离开 KKTerm。

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="Install Helper 目录，含已安装与可安装的工具" width="720" />
</p>

---

## KKTerm 不是什么

一份简短清单，因为诚实才能换到信任：

- **不是云端产品。** 没有同步、没有团队账号、没有 SaaS 套餐。如果你哪天看到「登录 KKTerm」对话框，那一定是出了什么天大的差错。
- **不假装所有操作系统都一样。** KKTerm 发布 Windows、macOS 和 Linux 版本，但平台特定功能会保持诚实：Windows 有原生 RDP ActiveX 路径和 Install Helper 目录，macOS 和 Linux 则使用这些系统上可用的可移植路径。
- **不是自主 AI agent。** 助理提议，人类决定。`Allow All` 是你自己做的选择，不是默认值。
- **不是 Grafana / Datadog 的替代品。** Dashboard 是给个人控制面板用的，不是给一万台主机观测用的。
- **不是 Kubernetes IDE。** 它是一个以终端为核心的管理工作区。拜托别叫它画 Helm chart。

如果上面任何一条*曾经*是你的雷点 — 公道，那我们 v2 见。

---

## 获取 KKTerm

**[下载最新版 KKTerm](https://github.com/ryantsai/KKTerm/releases/latest)**，选择适用于你平台的发行包并打开它。Windows 安装程序目前**未签名** — 发行签名在 roadmap 上，在那之前你的杀毒软件可能会对你投以严厉的眼神。这是正常的。

想从源码构建或贡献？你需要的一切都在 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

---

## Roadmap（精简版）

- 跨平台发行打磨
- 发行签名打磨
- 更强的文件传输（续传、文件夹同步、压缩/解压）
- 更完整的远程桌面剪贴板与设备共享
- 更多内建 Dashboard widget
- 更多 IT Ops 自动化功能

完整且经常更新的版本：[`docs/ROADMAP.md`](docs/ROADMAP.md)。

---

## 参与贡献

我们很欢迎有人帮忙。真心的。小事也算数。

完整的环境设置、项目结构与 PR 检查清单都在 [`CONTRIBUTING.md`](CONTRIBUTING.md)。在找切入点吗？用 [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 或 [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) 筛选 open issues。

---

## 项目文档

- [产品脉络](CONTEXT.md) — 你该对齐的领域语言
- [架构](docs/ARCHITECTURE.md) — 模块地图、新代码该放哪
- [使用手册](docs/manual/INDEX.md) — 一个功能一个功能走过一遍
- [Roadmap](docs/ROADMAP.md)
- [Dashboard 架构](docs/DASHBOARD.md)
- [内建 MCP 服务器](docs/MCP.md)
- [AI provider 指南](docs/AI_PROVIDERS.md)

---

## Star 历史

<a href="https://www.star-history.com/#ryantsai/KKTerm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ryantsai/KKTerm&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ryantsai/KKTerm&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=ryantsai/KKTerm&type=Date" />
  </picture>
</a>

---

## 许可证

MIT。见 [LICENSE](LICENSE)。用它、fork 它、拿去出货、把它放进一个没人找得到的 homelab — 这就是那个交易。

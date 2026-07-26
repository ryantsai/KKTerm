<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>一扇 Windows 原生視窗，搞定終端機、SSH、SFTP、RDP/VNC 和 Dashboard — 還附一個能照你要求打造專屬小工具的 AI。</strong>
</p>

<p align="center">
  <em>因為你的工作列不該長得像拉斯維加斯的吃角子老虎。</em>
</p>

<p align="center">
  <sub>名稱來自 <strong>乖乖</strong>，那包台灣系統管理員放在伺服器上、希望它好好工作的綠色椰子口味玉米點心。希望這個 app 也能爭取到它在機櫃上的一席之地。</sub>
</p>

<p align="center">
  <strong><a href="https://github.com/ryantsai/KKTerm/releases/latest">下載最新版 KKTerm</a></strong>
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
    <strong>繁體中文</strong> ·
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

## 45 秒簡報

KKTerm 將本機終端機、SSH/SFTP、FTP/FTPS、Telnet、序列埠、RDP/VNC、內嵌網頁、本機檔案與文件集中在同一個桌面工作區。一個 Tab 可以混合不同類型的 Pane，讓同一項工作的終端機、檔案瀏覽器與遠端畫面待在一起。

它支援 Windows、macOS 與 Linux，資料儲存在本機，不使用遙測。需要使用者核准的 AI、可自訂 Dashboard widget、Workspace、IT Ops 與 Windows Install Helper 均已內建。

---

## 為什麼叫「KKTerm」？

走進任何一座台灣的資料中心，抬頭看機櫃頂端。從台積電晶圓廠、台北捷運控制室、國泰銀行的機房、中華電信的交換機房 — 你都會看到一小包綠色的 **乖乖**，那是 1960 年代就有的椰子口味玉米點心。

**KKTerm** 就是 **Kuai Kuai Term** — 一個跟那包點心一樣有抱負的管理工作區：安靜地坐在你那些重要機器旁邊，幫它們乖一點。本地優先。零遙測。AI 全程要審批。那種無聊但可靠的軟體。

我們目前還沒辦法在 installer 裡塞一包真正的乖乖。那是 v2 的待辦事項。

---

## 親眼看看

<p align="center">
  <a href="https://github.com/ryantsai/KKTerm">
    <img
      src="docs/assets/demo.gif"
      alt="KKTerm demo"
      width="720"
    />
  </a>
</p>

<p align="center"><sub><em>（demo GIF。一張圖勝過一千個列點，而我們列點也快用完了。）</em></sub></p>

---

## 一扇視窗，所有連線

| 你想要… | KKTerm 幫你做到 |
| --- | --- |
| 開一個本機 PowerShell / cmd / WSL shell | 本機終端機，並排擺著 |
| SSH 進伺服器 | SSH 支援金鑰、agent、密碼、跳板主機與 port forwarding |
| 瀏覽那台伺服器上的檔案 | 從 SSH 連線直接開 SFTP — 雙窗格、拖曳就能傳 |
| FTP 到 2012 年的 NAS | FTP / FTPS，同一個檔案瀏覽器 |
| Telnet 連上古董設備 | 對，Telnet 也在裡面 |
| 跟序列埠對話 | Serial 連線 — 選個 COM port 和 baud 就好 |
| 遠端進一台 Windows 機器 | 內建貨真價實的微軟遠端桌面 |
| VNC 進一台 Pi | VNC，直接畫進工作區 |
| 開路由器的網頁後台 | 內嵌瀏覽器分頁，還會幫你帶入登入資訊 |
| 翻自己的本機磁碟 | 一個本機 File Explorer pane，和 SFTP 同一套雙窗格外殼 |
| 開一份 log、CSV、圖片或 PDF | 內建 Document 檢視器，還有真正能 tail 跟隨的 log 模式 |
| 看主機的 CPU | 即時狀態列，加上一個你可以自己堆東西的 Dashboard |

同一個 app。同一扇視窗。同一組快捷鍵。同一套但願不會讓你眼睛流血的主題。

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="同一個 Tab 並排放著 SSH、SFTP 和內嵌 Web UI" width="720" />
</p>

---

## 為什麼大家整天開著它

### 下載很小，啟動像閃電

KKTerm 做得像一個工具，而不是一整個平台。現在的桌面版不到 20 MB，安裝很快，啟動也快到不像是在開第二套作業系統。

### 多窗格格線，想怎麼混都行

一個 Tab 可以放一組 Pane 格線，而且這些 Pane 不必是同一種。SSH 旁邊放 SFTP、RDP Session 下面放本機 PowerShell、VNC 旁邊放路由器 Web UI，或把檔案瀏覽器放在正在搬檔案的終端機旁邊。

<p align="center">
  <img src="docs/assets/screenshots/multi-pane.png" alt="一個 Tab 切成四個不同連線種類的 pane" width="720" />
</p>

### 一個會幫你操控終端機的 AI 助理

大多數「終端機裡的 AI」demo 都停在聊天。KKTerm 的助理是在你的 session *裡面*運作：你把畫面上現有的內容當 context 交給它，它就對你連著的那些機器動手 — 而且全程有人類在審批迴圈裡。

<p align="center">
  <img src="docs/assets/screenshots/ai-assistant.png" alt="AI 助理面板，含工具存取與審批模式開關" width="720" />
</p>

### 一個不假裝自己是 Grafana 的 Dashboard

Dashboard 是一個可拖曳、可縮放的 widget 網格。它不是給你做 PB 級觀測用的 — 它是給「我想要一個按鈕啟動我最愛的五個 app，旁邊一個面板顯示我 SSH 主機的 uptime，*再旁邊*就是我的聊天視窗」用的。

Dashboard View 可使用 45 款 KKTerm 內建的動態背景；最新加入的八款 WebGL 程序化場景是 `heroGeometric`、`ditherPrismHero`、`webglLiquid`、`silkAurora`、`closingPlasma`、`animatedGradient`、`prismGradient` 與 `liquidChrome`。終端機 Connection、Document viewer 與 IT Ops 深入檢視也共用同一個背景選擇器；場景隱藏或移出畫面後便會停止繪製並釋放 WebGL 資源。

<p align="center">
  <img src="docs/assets/screenshots/ai-widgets.png" alt="一整片 AI 打造的 Dashboard widget" width="720" />
</p>

### 管理站點、主機與重複工作的 IT Ops

**IT Ops** Module 將連線整理成 Site、呈現伺服器機房與機櫃、管理 Host 清單，並在選取的機器上執行可重複使用的 Task。Batch Run 會保留每部 Host 的結果；Automation 則將觸發條件連結至通知、Webhook 或 Task。

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="IT Ops 伺服器機房立面檢視，顯示六座已配置設備的機櫃與主機狀態指示器" width="720" />
</p>

### 擷取、整理與標註螢幕截圖

**螢幕截圖** Module 可將選取區域、視窗或整個桌面擷取到本機圖庫、剪貼簿，或同時存入兩者。你可以排序與分組截圖、批次調整尺寸或轉換格式，也能在內建編輯器中裁切、手繪、加入箭頭、圖形與文字，或以馬賽克遮蔽內容。透過全域快速鍵與系統匣操作，按下快速鍵就能開始擷取。

<p align="center">
  <img src="docs/assets/screenshots/screenshots-module.png" alt="螢幕截圖 Module，顯示擷取控制項與縮圖圖庫" width="720" />
</p>

### 讓你的 AI agent 活著

這是大家愛上的第二個功能。KKTerm 的 SSH 終端機可以直接把你丟進遠端主機上一個**命名的 tmux session**，而且它撐得過重連。

<p align="center">
  <img src="docs/assets/screenshots/tmux-reattach.png" alt="SSH pane 在重連後重新 attach 回命名的 tmux session" width="720" />
</p>

### 用工作區把不同世界分開

homelab、正職工作、還有那個客戶的伺服器，本來就不該擠在同一份清單裡。**工作區（Workspaces）**是命名、彼此隔離的 Connection 容器，你可以從 Activity Rail 一鍵切換。切換只會重新框定連線樹 — 你打開的 Sessions、Dashboard 和設定都原地不動 — 所以換情境只花一下點擊，而不是重開 app。

<p align="center">
  <img src="docs/assets/screenshots/workspaces.png" alt="Activity Rail 上的工作區切換器" width="720" />
</p>

### 換上你喜歡的配色（色彩主題）

背景是好玩的部分；**色彩主題**才是你一整天真正盯著看的東西。KKTerm 內建**二十六種**色彩配色，會重新妝點整個 app 外殼 — Activity Rail、連線樹、分頁、對話框 — 在設定 ▸ 外觀裡每一種都有即時迷你預覽。

<p align="center">
  <img src="docs/assets/screenshots/color-themes.png" alt="設定裡的色彩配色網格，附即時預覽" width="720" />
</p>

### Install Helper（僅限 Windows）

把一台全新的 Windows 機器設定成開發環境，通常等於十個瀏覽器分頁加上一堆「下一步、下一步、完成」。**Install Helper** 是一個內建的工具目錄，幫你找到、安裝、更新並移除那些你本來得手動追的工具 — 全程不用離開 KKTerm。

<p align="center">
  <img src="docs/assets/screenshots/install-helper.png" alt="Install Helper 目錄，含已安裝與可安裝的工具" width="720" />
</p>

---

## KKTerm 不是什麼

一份簡短清單，因為誠實才能換到信任：

- **不是雲端產品。** 沒有同步、沒有團隊帳號、沒有 SaaS 方案。如果你哪天看到「登入 KKTerm」對話框，那一定是出了什麼天大的差錯。
- **不假裝所有作業系統都一樣。** KKTerm 發行 Windows、macOS 和 Linux 版本，但平台特定功能會保持誠實：Windows 有原生 RDP ActiveX 路徑和 Install Helper 目錄，macOS 和 Linux 則使用這些系統上可用的可攜路徑。
- **不是自主 AI agent。** 助理提議，人類決定。`Allow All` 是你自己做的選擇，不是預設值。
- **不是 Grafana / Datadog 的替代品。** Dashboard 是給個人控制面板用的，不是給一萬台主機觀測用的。
- **不是 Kubernetes IDE。** 它是一個以終端機為核心的管理工作區。拜託別叫它畫 Helm chart。

如果上面任何一條*曾經*是你的雷點 — 公道，那我們 v2 見。

---

## 取得 KKTerm

**[下載最新版 KKTerm](https://github.com/ryantsai/KKTerm/releases/latest)**，選擇適用於你平台的發行檔並開啟它。Windows 安裝程式目前**未簽章** — 發行簽章在 roadmap 上，在那之前你的防毒軟體可能會對你投以嚴厲的眼神。這是正常的。

想從原始碼建置或貢獻？你需要的一切都在 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

---

## Roadmap（精簡版）

- 跨平台發行打磨
- 發行簽章完善
- 更強的檔案傳輸（續傳、資料夾同步、壓縮/解壓）
- 更完整的遠端桌面剪貼簿與裝置共享
- 更多內建 Dashboard widget
- 更多 IT Ops 自動化功能

完整且時常更新的版本：[`docs/ROADMAP.md`](docs/ROADMAP.md)。

---

## 參與貢獻

我們很歡迎有人幫忙。真心的。小事也算數。

完整的環境設定、專案結構與 PR 檢查清單都在 [`CONTRIBUTING.md`](CONTRIBUTING.md)。在找切入點嗎？用 [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 或 [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) 篩選 open issues。

---

## 專案文件

- [產品脈絡](CONTEXT.md) — 你該對齊的領域語言
- [架構](docs/ARCHITECTURE.md) — 模組地圖、新程式碼該放哪
- [使用手冊](docs/manual/INDEX.md) — 一個功能一個功能走過一遍
- [Roadmap](docs/ROADMAP.md)
- [Dashboard 架構](docs/DASHBOARD.md)
- [內建 MCP 伺服器](docs/MCP.md)
- [AI provider 指南](docs/AI_PROVIDERS.md)

---

## 授權

MIT。見 [LICENSE](LICENSE)。用它、fork 它、拿去出貨、把它放進一個沒人找得到的 homelab — 這就是那個交易。

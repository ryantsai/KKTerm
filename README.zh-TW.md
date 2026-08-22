<p align="center">
  <img src="src-tauri/icons/logo.png" alt="KKTerm" width="128" />
</p>

<h1 align="center">KKTerm</h1>

<p align="center">
  <strong>一個跨平台桌面工作區，整合終端機、SSH/SFTP、RDP/VNC、檔案、網頁、IT Ops 與需要核准的 AI 助理。</strong>
</p>

<p align="center">
  <em>因為你的工作列不該長得像拉斯維加斯的吃角子老虎。</em>
</p>

<p align="center">
  <sub>名稱來自 <strong>乖乖</strong>，台灣系統管理員會放在伺服器上的綠色椰子口味玉米點心，希望它們乖乖工作。</sub>
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
    <img src="https://img.shields.io/badge/license-MIT%20%2B%20Commons%20Clause-blue?style=for-the-badge" alt="MIT License with Commons Clause" />
  </a>
  <a href="https://github.com/sponsors/ryantsai">
    <img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="在 GitHub 上贊助 KKTerm" />
  </a>
  <br />
  <img src="https://img.shields.io/badge/cross%E2%80%91platform-desktop-0078D6?style=flat-square" alt="跨平台桌面應用程式" />
  <img src="https://img.shields.io/badge/local--first-no%20telemetry-success?style=flat-square" alt="本機優先，無遙測" />
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

## 為什麼叫「KKTerm」？

KKTerm 就是 **Kuai Kuai Term**——取名自台灣系統管理員放在伺服器上的綠色乖乖，希望重要的機器安靜、可靠，也乖乖工作。

## 一個視窗，所有連線

KKTerm 將本機 Shell、SSH/SFTP、FTP/FTPS、Telnet、序列埠、RDP/VNC、URL 連線、本機檔案瀏覽器與文件檢視器集中在同一個桌面工作區。Tab 可以混合不同類型的 Pane，讓同一項工作的終端機、檔案瀏覽器、網頁介面與遠端畫面待在一起。

| 用途 | KKTerm |
| --- | --- |
| 本機 Shell | PowerShell、cmd 與 WSL |
| 遠端存取 | SSH、Telnet、序列埠、RDP 與 VNC |
| 檔案與網頁 | SFTP、FTP/FTPS、本機檔案與內嵌 URL 連線 |
| 文件 | 支援持續追蹤的記錄檔、文字、CSV、圖片與 PDF |

<p align="center">
  <img src="docs/assets/screenshots/connections-grid.png" alt="在同一個 KKTerm Tab 中混合 SSH、SFTP、終端機、URL 與 RDP Pane" width="720" />
</p>

## 為終端機周邊的工作而生

- **Workspace** — 混合 Tab 與 Pane、命名 Workspace、tmux 重新連線、Connection Notes、Git Browser 與 File Compare。
- **AI 助理** — 需要使用者核准的 Session、Dashboard、IT Ops 與 Custom Module 工具，還支援附件、傳送到終端機、MCP 與可重用的 Assistant Skills。
- **Dashboard** — 可切換的 View，以及能拖曳、調整大小的內建或 AI 建立 Widget；包含 App Launcher、即時 Connection 面板、Notes、用量計與實用工具。
- **IT Ops** — Site 的 Server Room 與 Rack 拓樸（elevation、floor plan、2.5D View）、Host 清冊與連通性掃描、可重用的 Script/Playbook Task、透過 SSH/WinRM/PsExec 執行的 Batch Run、IPAM、VLAN、Network Map、執行歷程與 PDF/CSV 匯出。
- **Screenshots** — 擷取區域、視窗或整個桌面，儲存到本機圖庫或剪貼簿，批次調整大小／轉換，並用裁切、圖形、文字與馬賽克工具標註。
- **Custom Modules** — 從 Settings 安裝隔離的 `.kkmod` 套件，檢視宣告的權限，將它們加入 Activity Rail，並管理更新、回復舊版、儲存空間與解除安裝。儲存庫包含 Excalidraw、BentoPDF、OpenFlowKit 與 TiddlyWiki 等整合。
- **Install Helper（Windows）** — 不離開 KKTerm，即可探索、安裝、更新與解除安裝工具，以及支援的本機 Web 應用程式與服務。

<p align="center">
  <img src="docs/assets/screenshots/itops.png" alt="KKTerm IT Ops Server Room 的 Rack elevation 與裝置健康狀態" width="720" />
</p>

## 打造自己的工作區

Dashboard View、終端機 Connection、文件檢視器與 IT Ops drill view 共用同一個背景選擇器。你可以選擇純色與漸層預設、本機圖片與影片，或 **84 個內建動態背景**：從海洋、天氣，到 WebGL 場景、太空、網路圖形與抽象動畫。隱藏或完全離開畫面的場景會暫停並釋放繪圖資源。色彩主題、終端機外觀、自訂字型與每個 Connection 的背景，讓工作區更符合你的習慣。

<p align="center">
  <img src="docs/assets/screenshots/backgrounds.png" alt="KKTerm 的動態背景選擇器" width="720" />
</p>

## 實際看看

<p align="center">
  <img src="docs/assets/demo.gif" alt="KKTerm 示範" width="720" />
</p>

## 取得 KKTerm

從 [最新版本](https://github.com/ryantsai/KKTerm/releases/latest) 下載 Windows、macOS 或 Linux 版本。Windows 提供安裝程式與 x64／ARM64 免安裝 ZIP；請將免安裝 ZIP 解壓縮到可寫入的本機資料夾或可移除磁碟，不要從網路分享位置執行。執行前請核對旁邊的 `.sha256` 檔案。

若要從原始碼建置，請先閱讀 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## 參與、支援與文件

歡迎貢獻程式碼與回報問題。請參閱 [`CONTRIBUTING.md`](CONTRIBUTING.md)，再瀏覽[操作手冊](docs/manual/INDEX.md)、[架構文件](docs/ARCHITECTURE.md)、[Dashboard 指南](docs/DASHBOARD.md)、[IT Ops 指南](docs/ITOPS.md) 與 [Custom Module Host API](docs/KKMOD_HOST_API_V2.md)。

如果 KKTerm 對你有幫助，也可以在 GitHub 上[贊助專案](https://github.com/sponsors/ryantsai)。

## 授權

KKTerm 原始碼採用 MIT 搭配 Commons Clause。Vendored crate、Custom Module、字型與圖示套件仍受各自授權條款約束，詳見 [`LICENSE`](LICENSE) 與各目錄中的授權和通知檔案。

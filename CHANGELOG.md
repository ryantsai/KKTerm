# Changelog

All notable changes to KKTerm are documented here.

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.7/kkterm-3000.0.7-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.7/kkterm-3000.0.7-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.7/kkterm-3000.0.7-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.7/kkterm-3000.0.7-windows-arm64-portable.zip)

## Highlights
- Cleaner terminal paste confirmation keyboard focus (no more “tabbing into the void”).
- Prevent false SSH idle disconnects for more stable Connection behavior.
- Improve screenshot export and clipboard compatibility.

## Improved
- **Terminal:** Fix keyboard access for multiline paste confirmation in the terminal.

## Fixed
- **SSH:** Prevent false SSH idle disconnects by disabling keepalive miss limit.
- **Screenshots:** Export original files and improve clipboard compatibility.

## Internal
- Refactor code structure for improved readability and maintainability.

---

## 精選重點
- 修正終端機多行貼上確認的鍵盤焦點（不再出現「Tab 往虛空走去」的狀況）。
- 避免 SSH 連線因誤判閒置而中斷，讓 Connection 更穩定。
- 改進截圖匯出與剪貼簿相容性。

## 改善
- **終端機：** 修正多行貼上確認的鍵盤存取。

## 修正
- **SSH：** 停用 keepalive miss limit 以防止錯誤的 SSH 閒置斷線。
- **截圖：** 匯出原始檔案並改善剪貼簿相容性。

## 內部
- 重構程式碼結構以提升可讀性與可維護性。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.6/kkterm-3000.0.6-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.6/kkterm-3000.0.6-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.6/kkterm-3000.0.6-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.6/kkterm-3000.0.6-windows-arm64-portable.zip)

## Highlights
- Reconnect the **active Session** faster with a new shortcut (SSH / Telnet / Serial), and get a reconnect button in the terminal pane when disconnected—because waiting for networks is a test of patience, not a feature.  
- Preserve native context menus across dynamic dashboard backgrounds.

## New
- Added a **reconnect active session** shortcut (and related terminal/connectivity documentation + i18n updates).

## Improved
- Connection Tree shortcut handling: F5 can reconnect a connection while avoiding default browser reload behavior.
- Terminal pane: shows a reconnect button when the terminal is disconnected.
- Dashboard: native context menus are preserved across dynamic backgrounds.

## Fixed
- Ignore private Store operations (to prevent unnecessary private store handling).  

## Internal
- Add/update Tauri updater support using separate manifests for macOS and Linux.
- Docs and code comments improvements (e.g., keyboard handling notes in `ConnectionSidebar`).
- Remove outdated localization todo entry related to the reconnect active session shortcut.
- Ignore private Store operations (via `.gitignore`).  

---

## 亮點
- 使用新增的捷徑更快速地**重新連線（Reconnect）目前的 Session**（支援 SSH / Telnet / Serial），並在終端機面板於中斷時顯示重新連線按鈕——等待網路回應本來就該是考驗耐心，不是功能。  
- 在動態儀表板背景下保留原生的內容選單。

## 新增
- 新增**重新連線目前 Session**的捷徑（並同步終端機/連線相關說明文件與多語系 i18n）。

## 改進
- 連線樹（Connection Tree）捷徑處理：F5 可用於重新連線，且避免觸發瀏覽器的預設重新載入行為。
- 終端機面板：中斷連線時會顯示重新連線按鈕。
- 儀表板：動態背景下可保留原生內容選單。

## 修正
- 忽略私有 Store 的操作（避免不必要的私有 Store 處理）。  

## Internal
- 支援 Tauri updater，並針對 macOS 與 Linux 使用不同的 manifest。
- 文件與程式碼註解更新（例如 `ConnectionSidebar` 的鍵盤處理註解）。
- 移除與重新連線目前 Session 捷徑相關的舊版 localization todo 記錄。
- 透過 `.gitignore` 忽略私有 Store 操作。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.5/kkterm-3000.0.5-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.5/kkterm-3000.0.5-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.5/kkterm-3000.0.5-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.5/kkterm-3000.0.5-windows-arm64-portable.zip)

## Highlights
- Updated translations for dynamic background terms across multiple languages (so your Dashboard doesn’t get lost in translation—like a terminal prompt in another timezone).
- Added ThreeUI themes for dashboard dynamic backgrounds.

## New
- ThreeUI themes added for dashboard dynamic backgrounds. [`6f16264`](https://github.com/ryantsai/KKTerm/commit/6f16264)

## Improved
- Updated i18n translations for dynamic background terms in multiple languages. [`f3953f9`](https://github.com/ryantsai/KKTerm/commit/f3953f9)
- Removed localization entries for dynamic backgrounds and updated translations across various languages. [`660fdc8`](https://github.com/ryantsai/KKTerm/commit/660fdc8)

## Fixed
- None reported in v3000.0.5 release context.

## Internal
- None reported in v3000.0.5 release context.

---

## 重點摘要
- 已更新多種語言的「動態背景」術語翻譯，讓你的 Dashboard 不至於在翻譯裡迷路（就像終端機提示字在另一個時區一樣）。
- 為 Dashboard 的動態背景加入 ThreeUI 主題（themes）。

## 新增
- 為 Dashboard 的動態背景加入 ThreeUI 主題。 [`6f16264`](https://github.com/ryantsai/KKTerm/commit/6f16264)

## 改進
- 更新多語系中「動態背景」術語的 i18n 翻譯。 [`f3953f9`](https://github.com/ryantsai/KKTerm/commit/f3953f9)
- 移除動態背景的部分在地化條目，並更新多種語言的翻譯內容。 [`660fdc8`](https://github.com/ryantsai/KKTerm/commit/660fdc8)

## 修正
- v3000.0.5 發行內容中未提供任何修正項目。

## Internal
- v3000.0.5 發行內容中未提供任何內部變更項目。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.4/kkterm-3000.0.4-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.4/kkterm-3000.0.4-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.4/kkterm-3000.0.4-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.4/kkterm-3000.0.4-windows-arm64-portable.zip)

## Highlights
- **IT Ops:** Server Room **Elevation** now follows the same shared floor grid as other Server Room layouts (so the report and the view stop disagreeing—no more “close enough” cabinets).  
- **Connections:** Fix **Serial** Panes going silent and make them more diagnosable. *(Issue #745 by lidewu; PR #749)*

## New
- **IT Ops:** Add a **View order** option to the **Server Room Rack** sort menu. *(PR #751)*  
  - Racks can be ordered to match how the view shows them (elevation bands, then top-to-bottom, left-to-right within a band).

## Improved
- **IT Ops:** **Server Room Elevation** is now projected from the shared floor grid (read-only projection; editing still happens in the Floor Plan / 2.5D view).

## Fixed
- **Connections:** Stop **Serial Panes** from going silent, and make them diagnosable. *(#745 by lidewu; #749)*  
  - Short bursts of output followed by no input should now behave properly, rather than leaving the Session “alive” but unusable.

## Internal
- Add Watermelon UI migration plan by @ryantsai in https://github.com/ryantsai/KKTerm/pull/748
- (Internal IT Ops work) Project Server Room elevation from the shared floor grid by @ryantsai in https://github.com/ryantsai/KKTerm/pull/750
- (Internal IT Ops work) Add View order to the Server Room Rack sort menu by @ryantsai in https://github.com/ryantsai/KKTerm/pull/751

---

## Highlights（重點）
- **IT Ops：** Server Room 的 **Elevation（立面）** 現在會和其他 Server Room 版面一樣，依照同一份「共用樓板格線（shared floor grid）」來呈現（不再出現報表與畫面「彼此不太一樣」的櫃子）。  
- **連線（Connections）：** 修正 **Serial（序列埠）Pane** 停止回應的問題，並提升可診斷性。*(Issue #745：lidewu；PR #749)*

## New（新增）
- **IT Ops：** 在 **Server Room Rack** 的排序選單中新增 **View order（依檢視順序）** 選項。*(PR #751)*  
  - 讓 Racks 的順序對齊畫面顯示方式（先 elevation bands，再由上到下，且在同一個 band 內由左到右）。

## Improved（改善）
- **IT Ops：** **Server Room Elevation** 改為從共用 floor grid 投影而來（此為讀取投影；編輯仍在 Floor Plan / 2.5D 版面進行）。

## Fixed（修正）
- **連線（Connections）：** 修正 **Serial Panes** 變成「無聲」的狀況，並提升可診斷性。*(#745：lidewu；#749)*  
  - 先短暫輸出、隨後無法再輸入的狀況，應會恢復正常；不再出現 Session 看似存在但實際上無法互動的情況。

## Internal（內部）
- 新增 Watermelon UI 遷移計畫：@ryantsai（https://github.com/ryantsai/KKTerm/pull/748）
- （內部 IT Ops）共用 floor grid 投影 Server Room elevation：@ryantsai（https://github.com/ryantsai/KKTerm/pull/750）
- （內部 IT Ops）在 Server Room Rack 排序選單新增 View order：@ryantsai（https://github.com/ryantsai/KKTerm/pull/751）

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.3/kkterm-3000.0.3-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.3/kkterm-3000.0.3-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.3/kkterm-3000.0.3-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.3/kkterm-3000.0.3-windows-arm64-portable.zip)

## Highlights
- Export **Connection Notes** to **Markdown** from the note editor toolbar (downloads a `.md` file via the native save dialog).  
- Add **RDP local printer redirection (Windows)** with a global default and per-Connection override.

## New
- **Connection Notes → Link editing**: Added a link popover to add/edit links inside notes (including deep link navigation confirmation). ([#5515acf](https://github.com/ryantsai/KKTerm/pull/747))
- **Connection Notes → Task list support**: Added checklist/task list functionality with checkbox support in notes. (✓ with editor + tests)
- **Connection Notes → Text styling**: Added text masking (reveal within the current Session) and text color formatting in the note toolbar.
- **Connection Notes → Markdown export**: Added a download control to export the current note content as Markdown.

## Improved
- Disable browser spellcheck and WebView2 context menu in the Connection Notes editor.
- Prevent text wrapping in note toolbar button labels for better readability.

## Fixed
- Harden serial Connection handling and preserve note **Deep Links**.

## Internal
- Clarify historical context for `sshSocksProxyInheritDefaults` in `connectionUsesTmux` (docs-only).
- Remove deprecated localization files for Deep Link and export features.

---

## 精選重點
- 從「連線筆記」編輯器的工具列匯出 **Connection Notes** 到 **Markdown**（透過原生儲存對話框下載 `.md` 檔）。  
- 新增 **RDP 本機印表機重新導向（Windows）**：支援全域預設與每個 Connection 的覆寫。

## 新增
- **連線筆記 → 連結編輯**：新增筆記內新增/編輯連結的 **Link Popover**（含深層連結導覽確認）。([#5515acf](https://github.com/ryantsai/KKTerm/pull/747))
- **連線筆記 → 勾選清單/任務**：加入支援 checkbox 的清單功能，讓你在筆記裡做任務。  
- **連線筆記 → 文字樣式**：加入文字遮罩（僅在目前 Session 可揭露）與筆記工具列的文字顏色格式化。
- **連線筆記 → Markdown 匯出**：新增下載控制項，將目前編輯內容匯出為 Markdown。

## 改善
- 在「連線筆記」編輯器中停用瀏覽器拼字檢查與 WebView2 內容選單。
- 改善筆記工具列按鈕文字換行問題，提升可讀性（讓按鈕不再像終端機輸出一樣到處折行）。

## 修正
- 強化序列埠（Serial）連線的處理，並保留筆記中的 **Deep Links**。

## Internal
- 釐清 `connectionUsesTmux` 中 `sshSocksProxyInheritDefaults` 的歷史背景（僅文件/註解）。
- 移除與 Deep Link 與匯出功能相關的已過時翻譯檔。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.2/kkterm-3000.0.2-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.2/kkterm-3000.0.2-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.2/kkterm-3000.0.2-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.2/kkterm-3000.0.2-windows-arm64-portable.zip)

## Highlights
- **Connection Notes (rich-text)**: Create a per-Connection note in each **Connection Pane** toolbar, with **images** and **Deep Links** (e.g., jump between a Connection, Workspace, or rack device). (PR #742, PR #8247164)
- **Expanded MCP file tools** and **workspace session coverage**. (PR #743, PR #b5f4451)
- **Portable updates**, **inherited SSH tmux behavior**, and **macOS serial ports** fixes—because release engineering shouldn’t be your full-time job. (PR #739, PR #c06ffe5)

## New
- **Connection Notes with rich-text editor, images, and Deep Links** (insert via `@` or toolbar picker). (PR #742)
- **Resizable note editor** UI. (PR #8247164, PR #52bfa09)

## Improved
- Repositioned the **NoteToolbar** button for **terminal** and **webview** connections. (PR #742, PR #9c1d147)

## Fixed
- **Portable updates** failure, **inherited SSH tmux** behavior, and **macOS serial ports**. Thanks to the reporters **JosephCLJ (#735)** and **Hank076 (#736)** (PR #739).
- Hardened the **Connection Note** lifecycle (save/load/delete wiring). Thanks to **lidewu (#737)**. (PR #739 / PR author credited in #739)
- Addressed **session file-browser** issues affecting **tool reviews** (including ensuring listing is read-only and correcting transfer queuing behavior). (PR #743 / PR #6d615c0)

## Internal
- Python runnable resolution for KKMod checks. (PR #47db530, PR #47db530)
- Test/coverage improvements around workspace session + file AI/MCP. (PR #743 / PR #6d615c0)
- IME support enhancements across text inputs/dialogs and IME composition guards for workspace/folder name editors. (PR #438d7c5, PR #ab908ed)
- VNC fullscreen fixed. (PR #8cb6da4)
- Added MSIX packaging support for Windows with embedded WebView2 runtime. (PR #a37da9c)

---

## Highlights（繁體中文（台灣））
- **連線筆記（富文字）**：在每個 **連線分頁（Connection Pane）工具列**新增**每個連線各自一份**的筆記，支援**圖片**與**Deep Links（深度連結）**（例如在不同的 Connection、Workspace 或機房裝置間跳轉）。(PR #742, PR #8247164)
- **擴充 MCP 檔案工具**與**工作階段（workspace session）覆蓋範圍**。 (PR #743, PR #b5f4451)
- **修正可攜式更新（portable updates）**、**繼承的 SSH tmux 行為**、以及**macOS 序列埠（serial ports）**——畢竟版本發布工程師不該變成你的全職網管。 (PR #739, PR #c06ffe5)

## New（新增）
- **Connection Notes：富文字編輯器、圖片與 Deep Links**（支援用 `@` 或工具列選擇器插入）。 (PR #742)
- **可調整大小**的筆記編輯器介面。 (PR #8247164, PR #52bfa09)

## Improved（改善）
- 調整 **NoteToolbar** 按鈕在 **終端機（terminal）**與**網頁檢視（webview）**連線中的位置。 (PR #742, PR #9c1d147)

## Fixed（修正）
- 修正 **可攜式更新失敗**、**繼承 SSH tmux 行為**、以及 **macOS 序列埠**問題。感謝回報者 **JosephCLJ (#735)** 與 **Hank076 (#736)**（PR #739）。
- 強化 **Connection Note** 的生命週期（save/load/delete 相關串接）。感謝 **lidewu (#737)**。 (PR #739 / PR author credited in #739)
- 修正 session file-browser 相關問題，影響工具回顧（包含確保 listing 為唯讀、以及修正傳輸佇列行為）。 (PR #743 / PR #6d615c0)

## Internal（內部）
- 修正 KKMod 檢查所需的可執行 Python。 (PR #47db530, PR #47db530)
- 工作階段 + 檔案 AI/MCP 覆蓋測試改善。 (PR #743 / PR #6d615c0)
- 全面提升文字輸入/對話框的 IME 支援，並在 workspace/資料夾名稱編輯器加入 IME 合成保護。 (PR #438d7c5, PR #ab908ed)
- 修正 VNC 全螢幕。 (PR #8cb6da4)
- 新增 Windows MSIX 打包支援（內建 WebView2 runtime）。 (PR #a37da9c)

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.1/kkterm-3000.0.1-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.1/kkterm-3000.0.1-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.1/kkterm-3000.0.1-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.1/kkterm-3000.0.1-windows-arm64-portable.zip)

## Highlights
- Added management support for signing-key passphrases in environment files (your deployment pipeline can now stop improvising with copy/paste).
- Improved macOS video recording dock behavior with corresponding event handling.
- Enhanced macOS local shell behavior to better mirror Terminal.app login shell environment.
- Expanded connection icon background picker options with an additional black color setting.

## New
- Signing-key passphrase management support in environment files.

## Improved
- macOS: Implemented video recording dock and event handling.
- macOS: Improved local shell behavior to mirror Terminal.app login shell environment.
- Connection: Added an additional black color option in the connection icon background picker.
- Updated AI instructions documentation for clarity and completeness.

## Fixed

## Internal
- Updated licensing information to include Commons Clause in relevant files.
- Removed obsolete codec licenses, icon, and build script from the Squoosh custom module (and cleared related tests).
- Merged changes from `main`.

---

## 精選重點
- 新增可在環境檔中管理簽名金鑰（signing-key）密語的支援（讓你的部署流程不再靠現場手動複製貼上）。
- 改善 macOS 影片錄製 Dock 的行為，並加入對應的事件處理。
- 強化 macOS 本機 Shell 行為，使其更貼近 Terminal.app 的登入 Shell 環境。
- 連線圖示背景選擇器新增一個額外的「黑色」選項。

## 新增
- 支援在環境檔中管理簽名金鑰密語。

## 改善
- macOS：實作影片錄製 Dock 與事件處理。
- macOS：強化本機 Shell 行為，使其更貼近 Terminal.app 登入 Shell 環境。
- 連線（Connection）：連線圖示背景選擇器新增額外的黑色選項。
- 更新 AI 指令說明文件，以提升清晰度與完整性。

## 修正

## Internal
- 更新授權資訊：在相關檔案中加入 Commons Clause。
- 移除 Squoosh 自訂模組中已過時的編碼器授權、圖示與建置腳本（並清理了相關測試）。
- 合併 `main` 分支的變更。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.0/kkterm-3000.0.0-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.0/kkterm-3000.0.0-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.0/kkterm-3000.0.0-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v3000.0.0/kkterm-3000.0.0-windows-arm64-portable.zip)

## Highlights
- Add support for **Custom Modules** in the **AI Assistant** context (with added localization/docs) — your assistant can finally “plug in” like the terminal you pretend to be.
- Improve **AI readiness checks** in the Host side and add tests.
- Preserve **automatic database backups** during app data deletion in the uninstaller.

## New
- **Custom Modules**: Support Custom Modules in AI Assistant context, including localization and documentation updates.  
  (2002e3e, 356edd3)

## Improved
- **Custom Module overlays**: Synchronize Custom Module overlay visibility with the main window on **macOS and Linux**.  
  (3e9bcc9)
- **Host-AI readiness checks**: Enhance readiness checks and add corresponding tests.  
  (6c53a2b)

## Fixed
- **Uninstaller data deletion**: Preserve automatic database backups during app data deletion in the uninstaller.  
  (0b326ad)

## Internal
- Release tooling: add a Cargo version check to prevent redundant version bumps.  
  (2002e3e)
- Version bump to `3000.0.0` and related lock/config updates.  
  (d359b1d)
- Assistant UI polish: animated border-beam effect in the assistant composer during response processing.  
  (cc4a819)

---

## Highlights（繁體中文-台灣）
- 新增 **AI 助理**的 **Custom Modules（自訂模組）**情境支援（含本地化與文件）——讓你的助理也能像你打算用的終端機一樣「能接就接」。
- 強化 Host 端 **AI readiness checks（就緒檢查）**並補上測試。
- 在解除安裝時刪除應用程式資料的同時，**保留自動資料庫備份**。

## New（新增）
- **Custom Modules**：在 AI 助理情境中支援 Custom Modules，並更新本地化與文件。  
  (2002e3e, 356edd3)

## Improved（改進）
- **Custom Module overlays**：在 **macOS 與 Linux** 同步自訂模組覆蓋層與主視窗的顯示狀態。  
  (3e9bcc9)
- **Host-AI readiness checks**：強化 Host 端就緒檢查並補上相對應測試。  
  (6c53a2b)

## Fixed（修正）
- **解除安裝資料刪除**：解除安裝流程刪除應用程式資料時，仍保留自動資料庫備份。  
  (0b326ad)

## Internal（內部）
- 發佈工具：加入 Cargo 版本檢查，避免重複的版本 bump。  
  (2002e3e)
- 版本更新至 `3000.0.0` 及相關 lock/設定檔更新。  
  (d359b1d)
- 助理 UI 細節：在助理處理回覆期間，於輸入區加入動畫邊框光束效果。  
  (cc4a819)

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.149/kkterm-0.1.149-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.149/kkterm-0.1.149-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.149/kkterm-0.1.149-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.149/kkterm-0.1.149-windows-arm64-portable.zip)

## v0.1.149 Release Notes

### Highlights
- Fixes Custom Module saving flow issues related to Squoosh asset URLs (no more “my custom module vanished into the void” moments).
- Improves IME behavior in the AI assistant composer to avoid premature message submission—your input stays yours.

### New
- Enhanced IME handling in the assistant composer to prevent premature submission.

### Improved
- Custom Module save bridge now correctly reads Squoosh-related assets and URLs.

### Fixed
- Custom Module save bridge reads correctly (including Squoosh asset URLs) after saving.
- IME input in the assistant composer no longer submits early while composing.

### Internal
- Bumped Squoosh to **2.0.2** as part of the Custom Module asset/URL fix.

---

## v0.1.149 發行說明（繁體中文 - 台灣）

### 重點（Highlights）
- 修正自訂模組（Custom Module）儲存流程中與 Squoosh 資產 URL 相關的問題（不再出現「我的自訂模組消失在黑洞裡」的情境）。
- 改善 AI 助理輸入框的 IME 行為，避免訊息過早送出——你的輸入不會被系統搶走。  

### 新增（New）
- 增強助理編輯器（assistant composer）的 IME 處理，避免過早提交。

### 改善（Improved）
- 自訂模組儲存橋接（save bridge）會正確讀取與 Squoosh 相關的資產與 URL。

### 修正（Fixed）
- 自訂模組儲存橋接可正確讀取（包含 Squoosh 資產 URL）儲存後的內容。
- 助理編輯器中的 IME 輸入不再在組字/輸入過程中提早送出。

### 內部（Internal）
- 為配合自訂模組的資產/URL 修正，將 **Squoosh** 更新至 **2.0.2**。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.148/kkterm-0.1.148-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.148/kkterm-0.1.148-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.148/kkterm-0.1.148-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.148/kkterm-0.1.148-windows-arm64-portable.zip)

## Highlights
- Custom module tooling updates to align with host readiness (so your Session has something to work with when it starts—no “where is the file?” mysteries).

## New
- Updated custom modules to **v2.0.1** (including Excalidraw and Squoosh).

## Improved
- Enhanced custom module packaging/permissions and runtime readiness handling for host startup.

## Fixed

## Internal
- Updated custom module build/publishing inputs and related host API documentation (e.g., `KKMOD_HOST_API_V2` docs and custom module packaging docs).
- Added/updated tests for custom module browser file compatibility, catalog publishing, and runtime behavior.  

**Full Changelog:** https://github.com/ryantsai/KKTerm/compare/v0.1.147...v0.1.148

---

## 精選重點
- 更新自訂模組工具流程以符合主機啟用就緒狀態（讓你的 Session 在啟動時就能找到該有的東西——不用再遇到「檔案呢？」的網路/終端機式疑案）。

## 新增
- 將自訂模組更新到 **v2.0.1**（包含 Excalidraw 與 Squoosh）。

## 改進
- 強化自訂模組的封裝/權限設定，並改善主機啟動階段的就緒處理。

## 修正

## 內部
- 更新自訂模組的建置/發佈相關輸入與文件（例如 `KKMOD_HOST_API_V2` 與自訂模組封裝說明）。
- 更新/新增測試：自訂模組瀏覽器檔案相容性、目錄發佈，以及執行期行為等。  

**完整變更記錄：** https://github.com/ryantsai/KKTerm/compare/v0.1.147...v0.1.148

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.147/kkterm-0.1.147-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.147/kkterm-0.1.147-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.147/kkterm-0.1.147-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.147/kkterm-0.1.147-windows-arm64-portable.zip)

## Highlights
- New Custom Module permissions for **file read/write** and **host integration**, plus a new **host AI** permission so your Session can request what it actually needs (and not what it *wishes* it needed).
- Added **OpenFlowKit host AI integration & settings routing**, and included readiness checks for AI generation capabilities.
- Introduced **TiddlyWiki** as a KKTerm Custom Module.
- Updated **Bentopdf** custom module to version **2.8.9**, including additional file extensions and new **network fetch** permissions for `POST` to `https://freetsa.org`.
- Custom Modules now show a **warning during full backup import** that they are **not included** in database backups.
- Custom module UI rail options were adjusted: **“Show in Activity Rail”** was removed.

## New
- Added **TiddlyWiki integration** as a KKTerm Custom Module (**7d6496f**).
- Added **host AI integration** for OpenFlowKit, including an AI settings UI (**e68be90**).

## Improved
- Enhanced **custom module permissions**:
  - Added directory **read/write** permissions for `CustomModuleFilePermission`.
  - Introduced `CustomModuleHostIntegrationPermission` and extended permission naming (**d0daa18**).
- Updated **Bentopdf** to **2.8.9** with enhanced file handling and **network fetch** permissions for `POST` to `https://freetsa.org` (**986e1ef**).

## Fixed
- Added a **warning** message during **full backup import** to clarify that **Custom Modules are not included in database backups** (**b9c3cce**).

## Internal
- Custom module window management improvements for macOS/Windows webview handling to help prevent deadlocks (**ebd19a2**).
- Refactored/removed some custom module rail visibility plumbing and updated related settings labels and tests (**036933a**).
- Cleanup: removed generated visual artifacts (**f535645**) and ignored generated package outputs (**98a1cf1**).
- Test/UI refactors and harness updates (e.g., activity rail test simplification **881bd9c**, rail order drag-and-drop work **abc099a**).

---

## 更新重點
- 新增自訂模組權限：支援**檔案讀寫**與**主機整合**，並新增**主機 AI**權限，讓 Session 只申請它真正需要的東西（而不是網路上看來很厲害但用不到的東西）。
- 完成 **OpenFlowKit 主機 AI 整合**與**設定導頁**，並加入 AI 生成能力的就緒檢查。
- 新增 **TiddlyWiki** 作為 KKTerm 自訂模組。
- 更新 **Bentopdf** 自訂模組至 **2.8.9**：包含更多檔案副檔名，並加入對 `https://freetsa.org` 的 `POST` **網路抓取**權限。
- 全量備份匯入時，針對自訂模組新增**警告**：表示自訂模組**不包含在資料庫備份**中。
- 調整自訂模組 UI：移除了 **「顯示於 Activity Rail」**相關選項。

## 新增
- 將 **TiddlyWiki** 以 KKTerm 自訂模組形式整合進來（**7d6496f**）。
- 新增 **OpenFlowKit 主機 AI**整合，包含 AI 設定 UI（**e68be90**）。

## 改進
- 強化自訂模組權限：
  - `CustomModuleFilePermission` 新增目錄**讀/寫**權限。
  - 引入 `CustomModuleHostIntegrationPermission`，並擴充權限命名（**d0daa18**）。
- 更新 **Bentopdf** 到 **2.8.9**：改善檔案處理，並新增對 `https://freetsa.org` 的 `POST` **網路抓取**權限（**986e1ef**）。

## 修正
- 在 **全量備份匯入**期間新增**警告**：說明 **Custom Modules 不包含在資料庫備份**中（**b9c3cce**）。

## Internal
- 改善 macOS/Windows 上自訂模組視窗（webview）管理，處理執行緒使用與避免死結（**ebd19a2**）。
- 移除/重整部分自訂模組 rail 可見性相關邏輯，並更新相關設定標籤與測試（**036933a**）。
- 清理：移除產生的視覺素材（**f535645**）與忽略產生的套件輸出（**98a1cf1**）。
- 測試/介面重構與測試框架更新（例如 Activity Rail 測試簡化 **881bd9c**、rail 排序拖放工作 **abc099a**）。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.146/kkterm-0.1.146-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.146/kkterm-0.1.146-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.146/kkterm-0.1.146-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.146/kkterm-0.1.146-windows-arm64-portable.zip)

## Highlights
- Dashboard: Maelstrom dynamic ocean background (Poseidon-derived) for extra “network weather” vibes. 🌊🐙 (PR #731)

## New
- Custom Modules API v2: enhanced permissions and data management, including UI for data usage and options to clear stored custom module data, plus secret prompts for custom modules.

## Improved
- Custom Modules: updated custom module catalog keys/URLs and improved migration handling for legacy API v1 modules.  
- Dashboard: improved variable naming for clarity in the Maelstrom background component (0d9eed5).

## Fixed
- Custom Modules (UI strings): translated/updated multiple UI strings across languages to keep Connection/Session-related, sleep mode, download, and custom module terminology consistent.

## Internal
- BentoPDF: added KKTerm v2 adapter and updated dependencies.
- Localization: added/updated many locale files (including Spanish, French, Indonesian, Italian, Japanese, Korean, Portuguese, Thai, Vietnamese, Simplified Chinese, and Traditional Chinese).  

---

## 亮點
- 儀表板：加入 Maelstrom 動態海洋背景（Poseidon 衍生），讓你的「網路天氣」看起來更有戲。🌊🐙（PR #731）

## 新增
- 自訂模組（Custom Modules）API v2：強化權限與資料管理，包含資料使用量的顯示與清除已安裝模組所儲存資料的選項，並新增自訂模組的密鑰/秘密（secret）提示介面。

## 改善
- 自訂模組：更新自訂模組目錄（catalog）鍵值/網址，並強化對舊版 API v1 模組的遷移處理。
- 儀表板：在 Maelstrom 背景元件中改進變數命名以提升可讀性（0d9eed5）。

## 修正
- 自訂模組（介面字串）：更新/翻譯多國語系的介面字串，讓與 Connection/Session 相關、睡眠模式、下載與自訂模組相關的用語在整個應用程式中保持一致。

## 內部
- BentoPDF：加入 KKTerm v2 adapter 並更新相依套件。
- 本地化：新增/更新大量語系檔案（包含西班牙語、法語、印尼語、義大利語、日語、韓語、葡萄牙語、泰語、越南語、簡體中文與繁體中文）。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.145/kkterm-0.1.145-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.145/kkterm-0.1.145-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.145/kkterm-0.1.145-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.145/kkterm-0.1.145-windows-arm64-portable.zip)

## Highlights
- Custom Module platform is getting more dynamic: richer curated catalog metadata, plus updated Install Helper AI Agent catalog/provider URLs.
- Excalidraw Custom Module is added with document storage and clipboard permissions (ready for your next “draw the topology” session).

## New
- Dynamic Custom Module platform (#726 by @ryantsai): unlocks a more flexible Custom Module platform foundation.
- Excalidraw Custom Module (#729 by @ryantsai): includes document storage and clipboard permissions.

## Improved
- Enhanced Custom Module catalog with new metadata and functionality (#727 by @ryantsai).
- Custom Module overlays/icons/settings layout fixes:
  - Better WebView handling and removal of outdated localization files (#728 by @ryantsai).
  - Fix custom module overlays, icons, and settings layout (commit @22e83b7).
- Prevent Module chrome selection (commit @783ad7a).

## Fixed
- Optimize SQLite access and encrypted secret store performance (#730 by @ryantsai) — because secrets shouldn’t lag like a bad network hop.
- Keep portable Custom Module data self-contained (commit @a477f9f).
- Render curated rail icons (commit @1a24098).

## Internal
- Optimize SQLite access and encrypted secret stores (merge of #730 by @ryantsai).
- Various documentation and styling updates for Custom Modules settings/layout.

---

## 重點摘要
- 自訂模組（Custom Module）平台變得更動態：包含更豐富的精選目錄（curated catalog）中繼資料，並同步更新 Install Helper AI Agent 目錄與提供者（provider）URL。
- 新增 Excalidraw 自訂模組：支援文件儲存與剪貼簿權限，讓你的下一段「把網路拓樸畫出來」的 Session 不再卡關。

## 新增
- 動態自訂模組平台（#726，由 @ryantsai 負責）：讓 Custom Module 平台具備更彈性的基礎。
- Excalidraw 自訂模組（#729，由 @ryantsai 負責）：包含文件儲存與剪貼簿權限。

## 改進
- 增強自訂模組目錄（Custom Module catalog）：新增中繼資料與功能（#727，由 @ryantsai 負責）。
- 修正自訂模組的覆蓋層（overlays）/圖示/設定版面：
  - 改善 WebView 處理並移除過時的在地化檔案（#728，由 @ryantsai 負責）。
  - 修正自訂模組覆蓋層、圖示與設定版面（@22e83b7）。
- 防止選到 Module 的 chrome（commit @783ad7a）。

## 修正
- 優化 SQLite 存取與加密的密鑰儲存效能（#730，由 @ryantsai 負責）——祕密不該像糟糕網路跳點一樣慢。
- 保留可攜式（portable）的自訂模組資料為獨立自成一體（commit @a477f9f）。
- 顯示精選（curated）的軌道/側邊列（rail）圖示（commit @1a24098）。

## 內部
- 優化 SQLite 存取與加密密鑰儲存（#730，由 @ryantsai 的合併工作）。
- 針對自訂模組設定/版面進行各種文件與樣式更新。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.144/kkterm-0.1.144-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.144/kkterm-0.1.144-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.144/kkterm-0.1.144-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.144/kkterm-0.1.144-windows-arm64-portable.zip)

## Highlights
- Improved Markdown Viewer rendering by adding Mermaid diagrams support (with lazy-loading in strict mode), so your network graphs don’t have to be hand-drawn like it’s 1999.

## New
- Added Mermaid diagrams to the Markdown viewer (lazy-load, strict mode).  
  *PR* #725 by @ryantsai (short SHA: `5e43f33`)

## Improved
- Updated System Cleaner localization keys and UI columns for extra headers, along with added/updated tests for correctness across locales.  
  (short SHA: `994b083`)
- Refined System Cleaner layout and related styles/types to improve the overview organization and clarity.  
  (short SHA: `e4e5013`, `8ee40fe`)
- Refactored System Cleaner scan phase and related types, plus updated tests and localization docs for the System Cleaner assistant tool description.  
  (short SHA: `0cfd8c2`)
- Added inline progress notifications in the Status Bar to better communicate routine operations within a Session workflow—while reserving prominent progress for higher-salience tasks.  
  *PR* (from changelog) by @ryantsai (short SHA: `d1b3010`)

## Fixed
- Fixed Windows “Open With” labeling so KKTerm is correctly identified.  
  Issue reporter(s): *none listed*  
  *PR* #724 by @ryantsai (short SHA: `aca3212`)

## Internal
- Updated localization documentation and tests related to System Cleaner (including safety/performance coverage and rendered-page assertions).  
  (short SHAs: `7c95259`, `d988631`)

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.143/kkterm-0.1.143-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.143/kkterm-0.1.143-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.143/kkterm-0.1.143-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.143/kkterm-0.1.143-windows-arm64-portable.zip)

## Highlights
- **System Cleaner** is now available in the **AI Assistant** settings, with updated tutorial navigation—because your Session shouldn’t have to carry everyone else’s cache baggage.

## New
- **System Cleaner** tool added to the **AI Assistant** (including default configuration, navigation, and settings/search support).  
  - PR: https://github.com/ryantsai/KKTerm/pull/723

- **System File Menu** support for **macOS and Linux**. (File menu labels + open/close file menu behavior.)

## Improved
- Consolidated and pruned superseded documentation to reduce “which doc was it again?” moments.
  - PR: https://github.com/ryantsai/KKTerm/pull/723
- Traditional Chinese (Taiwan) localization updated for **management/cleanup** and Windows app-related strings.

## Fixed
- Refactored obsolete localization files and updated **system-cleaner** labels/descriptions across multiple languages.

## Internal
- Added/updated tests covering **System Cleaner** in the AI Assistant and settings search, plus System Cleaner safety/performance.

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.142/kkterm-0.1.142-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.142/kkterm-0.1.142-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.142/kkterm-0.1.142-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.142/kkterm-0.1.142-windows-arm64-portable.zip)

## Highlights
- Add **Exa** as a new Web Search provider (no API key required for searching via the web search tool).
- Upgrade the **System Cleaner** with a new **file recommendations** + review/delete flow.
- Improve **macOS file associations** and Windows installer **“Open With”** options so KKTerm can be selected per file type.

## New
- **System Cleaner: File recommendations for review & deletion** (Dashboard Widget Instance: System Cleaner view) — including localized UI and confirmation dialogs for deletion.  
  - (PR: none) — see commits: `e262391`, `5871f3e`
- **System Cleaner: Integrate WinDirStat** for disk allocation scanning (with install prompts, availability checks, and status handling).  
  - (PR: none) — see commit: `8a899d7`
- **Syntax highlighting profiles** with management, localization, and built-in profiles (Cisco IOS / Juniper Junos / Operational Logs).  
  - (PR: none) — see commits: `df3fe75` (and related follow-ups)

## Improved
- **Syntax highlighting**: simplify profile management (removing font/style attribute handling) and **switch to case-insensitive matching** (removes UI “caseSensitive” option).  
  - (PR: none) — see commits: `bcda939`, `7be7770`
- **Syntax highlighting UI**: enhanced ColorPalettePicker swatch triggering + popover positioning.  
  - (PR: none) — see commit: `5f7f33c`
- **Exa Web Search provider**: settings UI now includes Exa as a selectable provider, with optional API key input and improved localization.  
  - (PR: none) — see commit: `52cd7ca`
- **macOS file handling & installer hooks**: file associations via `tauri.macos.conf.json`, Windows NSIS hook for “Open With”, and macOS opened-URL handling.  
  - (PR: none) — see commit: `14ae993`

## Fixed
- **i18n clarity/accuracy** for storage scanning & cleaning messages (updated translations across multiple languages).  
  - (PR: none) — see commit: `08714bc`

## Internal
- **System Cleaner: automated WinDirStat installation during first scan** (installer/setup flow without a confirmation prompt).  
  - (PR: none) — see commit: `b2a5ff8`
- **Tests & localization documentation** updates across System Cleaner and syntax highlighting.  
  - (PR: none) — see commits: `defc040`, `5871f3e`, `d5956cb`, `c8e4287`, `0a438b0`, `ad04c7f`
- **Add macOS private API support & update Tauri dependencies**.  
  - (PR: none) — see commit: `fb17d9e`
- **Remove deprecated Exa documentation** from localization todo.  
  - (PR: none) — see commit: `0a438b0`
- **Rework installer/test tooling for syntax highlighting** (add tool support, built-in profile integrity tests, etc.).  
  - (PR: none) — see commit: `defc040`

---

## Highlights（繁體中文（台灣））
- 新增 **Exa** 作為 Web Search 搜尋提供者（使用 Web 搜尋工具時可在不提供 API key 的情況下搜尋）。
- 強化 **系統清理（System Cleaner）**：加入新的 **檔案建議（recommendations）**，並提供檢視/刪除流程。
- 改善 **macOS 檔案關聯**與 Windows 安裝程式的 **「使用其他應用程式開啟（Open With）」**選項，讓 KKTerm 能在各檔案類型中被選擇。

## New（新增）
- **系統清理：檔案建議（recommendations）供審核與刪除**（Dashboard Widget Instance：System Cleaner 檢視畫面）—包含多語系介面與刪除確認對話框。  
  -（PR：無）— 參考提交：`e262391`, `5871f3e`
- **系統清理：整合 WinDirStat 做磁碟配置掃描**（含安裝提示、可用性檢查與狀態處理）。  
  -（PR：無）— 參考提交：`8a899d7`
- **語法高亮（syntax highlighting）設定檔（profiles）**：包含管理能力、多語系支援與內建範本（Cisco IOS / Juniper Junos / Operational Logs）。  
  -（PR：無）— 參考提交：`df3fe75`（以及相關後續提交）

## Improved（改進）
- **語法高亮**：簡化設定檔管理（移除 font/style 屬性相關處理）並切換為**不分大小寫**比對（移除介面中的「caseSensitive」選項）。  
  -（PR：無）— 參考提交：`bcda939`, `7be7770`
- **語法高亮 UI**：強化 ColorPalettePicker（支援色塊觸發與彈出視窗定位）。  
  -（PR：無）— 參考提交：`5f7f33c`
- **Exa Web Search 提供者**：設定介面加入 Exa，可選擇提供者，並保留 API key 的選填輸入，且多語系呈現更完整。  
  -（PR：無）— 參考提交：`52cd7ca`
- **macOS 檔案處理與安裝掛勾**：透過 `tauri.macos.conf.json` 設定檔案關聯、Windows 端用 NSIS hook 提供「Open With」選項，並改善 macOS 開啟 URL 的處理。  
  -（PR：無）— 參考提交：`14ae993`

## Fixed（修正）
- **i18n 翻譯清晰度/正確性**：更新儲存掃描與清理訊息的多語系翻譯。  
  -（PR：無）— 參考提交：`0871f3c`

## Internal（內部）
- **系統清理：首次掃描時自動安裝 WinDirStat**（安裝/設定流程不再要求確認提示）。  
  -（PR：無）— 參考提交：`b2a5ff8`
- **測試與系統清理/語法高亮文件**：多項測試與在地化文件更新。  
  -（PR：無）— 參考提交：`defc040`, `5871f3e`, `d5956cb`, `c8e4287`, `0a438b0`, `ad04c7f`
- **新增 macOS private API 支援並更新 Tauri 相依套件**。  
  -（PR：無）— 參考提交：`fb17d9e`
- **移除已過時的 Exa 文件（localization todo）**。  
  -（PR：無）— 參考提交：`0a438b0`
- **語法高亮測試/安裝相關工具調整**（例如加入工具清單辨識、內建設定檔完整性測試等）。  
  -（PR：無）— 參考提交：`defc040`

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.141/kkterm-0.1.141-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.141/kkterm-0.1.141-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.141/kkterm-0.1.141-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.141/kkterm-0.1.141-windows-arm64-portable.zip)

## Highlights
- Improved **System Cleaner** scan + cleanup reliability by preventing **terminal windows** from popping open during scan operations. (PR: #898f3eb)
- Restored **video recording controls** and grouped **tray** capture items under the **Screenshots** heading. (PR: #722)

## New
- **System Cleaner**: Added allocated storage metrics to the UI, with localized strings and clearer logical vs allocated size reporting.

## Improved
- **System Cleaner**: Enhanced scan/counter phases and tracking for the orb-driven scan experience.
- **Dashboard Widgets (WebGL backgrounds)**: Improved WebGL background robustness by stabilizing Componentry shader noise (integrated GPUs) and refining Waters tessellation behavior.

## Fixed
- Fixed **Waters** dynamic background mesh seams on integrated GPUs. (PR: #720)
- Fixed **video recording** command handling by converting `start_video_recording` to async. (PR: #f7bdc00)
- Fixed **Waters** dynamic background mesh seams on integrated GPUs (PR: #720).
- Restored **recording controls** and tray grouping under **Screenshots**. (PR: #722)

## Internal
- Added GitHub Sponsors links to README files. (PR: #719)
- Updated System Cleaner internals for improved NTFS size resolution and data handling in MFT processing. (PR: #229bf51)

---

## 亮點
- 改善 **System Cleaner** 掃描與清理的可靠性：在掃描作業進行時，會避免突然打開 **終端機視窗**。 (PR: #898f3eb)
- 恢復 **影片錄製** 控制項，並將 **系統匣（tray）** 的擷取項目歸到 **Screenshots** 標題之下。 (PR: #722)

## 新增
- **System Cleaner**：在介面中加入已配置（allocated）的磁碟空間指標，並提供本地化字串，同時更清楚區分「邏輯大小」與「已配置大小」。

## 改善
- **System Cleaner**：強化掃描流程的階段/狀態追蹤，讓掃描時的球狀顯示更好掌控。
- **Dashboard Widget（WebGL 背景）**：提升 WebGL 背景穩定性——透過強化 Componentry 在整合型 GPU 上的著色器雜訊，以及精修 Waters 的細分（tessellation）行為。

## 修正
- 修正整合型 GPU 上 **Waters** 動態背景的網格縫線問題。 (PR: #720)
- 修正 **影片錄製** 指令處理：將 `start_video_recording` 改為非同步（async）。 (PR: #f7bdc00)
- 修正 **Waters** 動態背景網格縫線（PR: #720）。
- 恢復 **錄製控制項** 與 **tray** 分類，並歸到 **Screenshots**。 (PR: #722)

## Internal
- 在各語言的 README 檔案加入 GitHub Sponsors 連結。 (PR: #719)
- 更新 System Cleaner 內部實作：改善針對 MFT 處理的 NTFS 大小解析與資料處理。 (PR: #229bf51)

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.140/kkterm-0.1.140-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.140/kkterm-0.1.140-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.140/kkterm-0.1.140-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.140/kkterm-0.1.140-windows-arm64-portable.zip)

## Highlights
- Handle Windows `Ctrl+Alt+Break` for Remote fullscreen toggling, with docs and tests updated (PR [#704](https://github.com/ryantsai/KKTerm/pull/704) by @ryantsai). (Small sysadmin nod: at least the keyboard isn’t “breaking” us today.)
- New System Cleaner module with parallel scans, UAC-elevated uninstaller, and operation logging (PR [#718](https://github.com/ryantsai/KKTerm/pull/718) by @ryantsai).

## New
- Added System Cleaner module (PR [#718](https://github.com/ryantsai/KKTerm/pull/718) by @ryantsai).

## Improved
- Optimize Network Map rendering (PR [#712](https://github.com/ryantsai/KKTerm/pull/712) by @ryantsai).
- Expose IT Ops Rack layout controls to the AI assistant (PR [#714](https://github.com/ryantsai/KKTerm/pull/714) by @ryantsai).
- Improve Server Room/IT Ops rack ordering (PR [#713](https://github.com/ryantsai/KKTerm/pull/713) by @ryantsai).  
  - Reported by @jfphi in #707.

- Fix remote MCP protocol negotiation and complete tools discovery (PR [#716](https://github.com/ryantsai/KKTerm/pull/716) by @ryantsai).

- Fix RDP fullscreen disconnect restoration (PR [#717](https://github.com/ryantsai/KKTerm/pull/717) by @ryantsai).  
  - Reported by @ryantsai in #710.

## Fixed
- Windows `Ctrl+Alt+Break` handling for Remote fullscreen toggle (PR [#704](https://github.com/ryantsai/KKTerm/pull/704) by @ryantsai).
- Network Map rendering improvements (PR [#712](https://github.com/ryantsai/KKTerm/pull/712) by @ryantsai).
- Server Room rack ordering (PR [#713](https://github.com/ryantsai/KKTerm/pull/713) by @ryantsai).  
  - Issue reporter: @jfphi (#707).
- Remote MCP protocol negotiation and tool discovery (PR [#716](https://github.com/ryantsai/KKTerm/pull/716) by @ryantsai).
- RDP fullscreen disconnect restoration (PR [#717](https://github.com/ryantsai/KKTerm/pull/717) by @ryantsai).  
  - Issue reporter: @ryantsai (#710).

## Internal
- Harden System Cleaner performance and safety (PR [#718](https://github.com/ryantsai/KKTerm/pull/718) by @ryantsai).
- Dependency/tooling updates and general maintenance (e.g., workerd version bump; dependency bumps like `russh`, `russh-sftp`, and `oxc`).

---

## 重點摘要
- 處理 Windows 的 `Ctrl+Alt+Break` 用於 Remote 全螢幕切換，並同步更新文件與測試（PR [#704](https://github.com/ryantsai/KKTerm/pull/704)；作者 @ryantsai）。(小小 IT 風幽默：至少不是鍵盤先「斷線」給你看。)
- 新增 System Cleaner 模組：支援平行掃描、使用 UAC 提權的解除安裝，以及操作記錄（PR [#718](https://github.com/ryantsai/KKTerm/pull/718)；作者 @ryantsai）。

## 新增
- 新增 System Cleaner 模組（PR [#718](https://github.com/ryantsai/KKTerm/pull/718)；作者 @ryantsai）。

## 改善
- 優化 Network Map 繪製（PR [#712](https://github.com/ryantsai/KKTerm/pull/712)；作者 @ryantsai）。
- 將 IT Ops Rack 佈局控制項曝光給 AI 助理（PR [#714](https://github.com/ryantsai/KKTerm/pull/714)；作者 @ryantsai）。
- 改善 Server Room／IT Ops 機櫃（Rack）排序（PR [#713](https://github.com/ryantsai/KKTerm/pull/713)；作者 @ryantsai）。
  - 由 @jfphi 於 #707 回報。

- 修正遠端 MCP 協定協商與完成工具（tools）探索（PR [#716](https://github.com/ryantsai/KKTerm/pull/716)；作者 @ryantsai）。
- 修正 RDP 全螢幕斷線後的還原（PR [#717](https://github.com/ryantsai/KKTerm/pull/717)；作者 @ryantsai）。
  - 由 @ryantsai 於 #710 回報。

## 修復
- 修正 Windows `Ctrl+Alt+Break` 用於 Remote 全螢幕切換的處理（PR [#704](https://github.com/ryantsai/KKTerm/pull/704)；作者 @ryantsai）。
- Network Map 繪製相關改善（PR [#712](https://github.com/ryantsai/KKTerm/pull/712)；作者 @ryantsai）。
- Server Room 機櫃排序（PR [#713](https://github.com/ryantsai/KKTerm/pull/713)；作者 @ryantsai）。
  - Issue 回報者：@jfphi（#707）。
- 遠端 MCP 協定協商與工具探索（PR [#716](https://github.com/ryantsai/KKTerm/pull/716)；作者 @ryantsai）。
- RDP 全螢幕斷線後的還原（PR [#717](https://github.com/ryantsai/KKTerm/pull/717)；作者 @ryantsai）。
  - Issue 回報者：@ryantsai（#710）。

## Internal
- 強化 System Cleaner 的效能與安全性（PR [#718](https://github.com/ryantsai/KKTerm/pull/718)；作者 @ryantsai）。
- 依賴項／工具鏈更新與一般維護（例如 workerd 版本更新；依賴項更新如 `russh`、`russh-sftp`、`oxc`）。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.139/kkterm-0.1.139-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.139/kkterm-0.1.139-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.139/kkterm-0.1.139-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.139/kkterm-0.1.139-windows-arm64-portable.zip)

## Highlights
- Added MCP protocol version negotiation support in `kkterm-cli`, including support for legacy versions. (Terminal—now speaking the dialects.)

## New
- MCP protocol version negotiation and legacy version support in `kkterm-cli`.

## Internal
- Documentation and MCP protocol implementation updates supporting the new negotiation behavior.

---

## 精選重點
- 已在 `kkterm-cli` 新增 MCP 協定版本協商支援，並支援舊版版本。（終端機終於學會更多方言了。）

## 新功能
- 在 `kkterm-cli` 中加入 MCP 協定版本協商與舊版支援。

## Internal（內部）
- 更新文件與 MCP 協定實作，以支援上述協商行為。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.138/kkterm-0.1.138-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.138/kkterm-0.1.138-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.138/kkterm-0.1.138-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.138/kkterm-0.1.138-windows-arm64-portable.zip)

## Highlights
- Fixed VNC fullscreen frame ownership and Rack placement (including rear face) for a smoother Remote Desktop experience—like the terminal gods intended. 🖥️🧩

## New
- Added support for **Nerd Font Home** in custom font diagnostics and metadata.

## Improved
- Improved VNC and RDP Session handling with enhanced refresh logic and canvas resizing.
- Enhanced VNC and rack management for better content visibility and connection tracking across Tab/Pane experiences.

## Fixed
- Fixed **VNC fullscreen** frame ownership and **Rack View** placement (rear included) in https://github.com/ryantsai/KKTerm/pull/702 (by @ryantsai; merge/fix reference: fbc4c68).

## Internal
- Updated rack item filtering logic for front/rear faces in 2.5D rendering (tests/itops-rack-mount-face-ui.test.mjs; 672af22).
- Enhanced font atlas management and terminal rendering readiness (d578dae).
- Improved/added tests covering VNC fullscreen ownership and rack callouts/inventory completion (multiple; e.g., vnc-fullscreen-frame-owner.test.mjs, itops-rack-callout-performance.test.mjs).

---

## 亮點
- 修正 **VNC 全螢幕**的畫面框架（frame）擁有權，以及 **機架（Rack）**的放置位置（包含背面），讓遠端桌面體驗更順——就像終端機之神的安排一樣。🖥️🧩

## 新增
- 在自訂字型的診斷與中繼資料中加入 **Nerd Font Home** 支援。

## 改進
- 強化 VNC 與 RDP 的 Session 處理：包含更好的重新整理邏輯與 canvas 調整大小。
- 改善 VNC 與機架管理：提升內容可見性與連線追蹤，讓在 Tab/Pane 的互動更一致。

## 修正
- 修正 **VNC 全螢幕**畫面框架擁有權，以及 **Rack View** 位置（含背面），詳見 https://github.com/ryantsai/KKTerm/pull/702（作者 @ryantsai；修正/合併參考：fbc4c68）。

## Internal
- 更新 2.5D 渲染的機架項目前/背面篩選邏輯（tests/itops-rack-mount-face-ui.test.mjs；672af22）。
- 強化字型 atlas 管理與終端機渲染就緒（d578dae）。
- 補強/新增測試：包含 VNC 全螢幕擁有權與機架 callout/目錄補全等（多個；例如 vnc-fullscreen-frame-owner.test.mjs、itops-rack-callout-performance.test.mjs）。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.137/kkterm-0.1.137-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.137/kkterm-0.1.137-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.137/kkterm-0.1.137-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.137/kkterm-0.1.137-windows-arm64-portable.zip)

## Highlights
- New **VNC performance tuning presets** and settings for your Connection dialog (including compression level and JPEG options).  
- Screenshot capture updates that add **capture delay settings** and improve handling for tray/shortcut captures.  

## New
- Added VNC performance tuning options and presets:
  - Compression level, **JPEG quality**, and **JPEG enabled** options
  - Presets such as Auto/Balanced/Custom/LAN/Lossless/Low bandwidth

## Improved
- VNC performance tuning input handling was simplified to better support tuning workflows.  
- Screenshot capture received **capture delay** support and improved event handling for **tray** and **shortcut** captures.

## Fixed
- No user-facing fixes listed in this release context.

## Internal
- Documentation and localization updates for VNC performance settings (including removing deprecated VNC localization TODO files and updating translations across multiple languages).
- Added/updated tests for VNC frame pipeline and VNC performance presets, plus tests around IT Ops and screenshot capture behavior.

**Full Changelog:** https://github.com/ryantsai/KKTerm/compare/v0.1.136...v0.1.137

---

## 重點摘要
- 在你的 **Connection（連線）** 對話框中新增 **VNC 效能調校預設**與設定（包含壓縮等級與 JPEG 相關選項）。  
- 截圖擷取更新：加入 **擷取延遲設定**，並強化來自托盤/快捷鍵的擷取事件處理（讓你的螢幕截圖不再像網路抽獎一樣玄學）。  

## 新增
- 新增 VNC 效能調校選項與預設：
  - 壓縮等級、**JPEG 品質**、**JPEG 啟用**等選項
  - 預設包含 Auto / Balanced / Custom / LAN / Lossless / Low bandwidth

## 改善
- 簡化 VNC 效能調校輸入的事件處理，讓調校流程更順。  
- 截圖擷取加入 **擷取延遲**，並改善托盤與快捷鍵擷取的事件處理。

## 修正
- 本版發行內容未列出使用者面向的修正。

## Internal
- 更新 VNC 效能設定的文件與多語系翻譯（包含移除已棄用的 VNC localization TODO 檔，並更新多語系翻譯）。
- 新增/更新 VNC frame pipeline 與 VNC performance presets 的測試，以及 IT Ops 與截圖擷取相關行為的測試。

**完整變更紀錄（Full Changelog）：** https://github.com/ryantsai/KKTerm/compare/v0.1.136...v0.1.137

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.136/kkterm-0.1.136-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.136/kkterm-0.1.136-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.136/kkterm-0.1.136-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.136/kkterm-0.1.136-windows-arm64-portable.zip)

## Highlights
- **Portable Assistant Skills**: Fix incomplete portable Assistant Skills so **portable mode** can read **skills** correctly (PR #701, by @ryantsai; issue reported by @jfphi in #700).  
- **RDP Sessions**: Clarify and enhance **reconnect behavior** and **focus management** for **RDP** sessions, including related guidance in the docs (PRs #? not provided in context).

## New
- **IT Ops (ITOPS)**: Expanded **network maps** and **IPAM imports**.

## Improved
- **IT Ops (ITOPS)**: Enhanced network map edge readout display and **IPAM menu behavior**.
- **RDP Sessions**: Improved **focus management** for **RDP** sessions and enhanced **reconnect behavior**.

## Fixed
- **Portable mode / Assistant Skills**: Fixed incomplete portable Assistant Skills (PR [#701](https://github.com/ryantsai/KKTerm/pull/701); reported by @jfphi in #700, fixed by @ryantsai).

## Internal
- Docs maintenance: removed obsolete localization todo files for IPAM and network map shapes.
- IT Ops code cleanup: simplified network graph structure and removed obsolete root references.  

---

## 亮點（Highlights）
- **可攜式助理技能（Portable Assistant Skills）**：修正「可攜式模式」下 **技能（skills）** 讀取不完整的問題（PR #701，作者 @ryantsai；#700 由 @jfphi 提出回報）。  
- **RDP 連線（RDP Sessions）**：釐清並強化 **RDP** 連線的 **重新連線（reconnect）行為**與 **焦點管理（focus management）**，相關文件也一併更新（本版提供的上下文未包含 PR 編號）。

## 新增（New）
- **IT Ops（ITOPS）**：擴充 **網路地圖（network maps）** 與 **IPAM 匯入（IPAM imports）**。

## 改進（Improved）
- **IT Ops（ITOPS）**：強化網路地圖邊緣讀值顯示，以及 **IPAM 選單行為**。
- **RDP 連線（RDP Sessions）**：改善 **RDP** 的 **焦點管理**，並增強 **重新連線（reconnect）行為**。

## 修正（Fixed）
- **可攜式模式 / 助理技能**：修正可攜式助理技能不完整問題（PR [#701](https://github.com/ryantsai/KKTerm/pull/701)；由 #700 @jfphi 回報、@ryantsai 修正）。

## 內部（Internal）
- 文件維護：移除 IPAM 與網路地圖形狀相關的舊版在地化待辦檔案。
- IT Ops 程式清理：簡化網路圖結構並移除不再需要的根參考。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.135/kkterm-0.1.135-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.135/kkterm-0.1.135-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.135/kkterm-0.1.135-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.135/kkterm-0.1.135-windows-arm64-portable.zip)

## Highlights
- **IPAM exports for CSV, TSV, and XLSX** are now available—because sometimes you need your topology in something other than pure text-as-configuration.  
- **Network Map node locking** lets you lock Network Map nodes and notes so they don’t move or resize while you’re editing.

## New
- **IPAM CSV, TSV, and XLSX export options** (https://github.com/ryantsai/KKTerm/pull/697) — by @ryantsai.

## Improved
- **Network Map (IT Ops) updates** including additional statistics display and Geomap sizing fields with validation and localization support.
- **Network Map designer** enhancements for Geomap handling with dynamic sizing and properties adjustments.
- **Ephemeral screenshot editing + launch path handling**:
  - Edit/save screenshots without persisting them in the library.
  - Support opening files/folders passed via command line, with ephemeral Tabs so the view options don’t persist.

## Fixed
- **Locked state handling for Network Map search and selection context**:
  - Locked nodes/notes are ignored for canvas changes and included in Network Map search criteria.
  - Selection management supports context menu actions for locked items.
- **Localization maintenance**:
  - Removed obsolete localization files and updated translations across multiple languages for consistency/accuracy (including zh-TW).

## Internal
- **Localization + docs work** for IT Ops and Network Map UI strings and artwork.
- **Tests added/updated** for network map locking behavior, Geomap layout/canvas changes, IPAM export, and launch path + ephemeral screenshot behavior.  

---

## 亮點
- **IPAM 支援 CSV、TSV 與 XLSX 匯出**—有時候拓樸需要的不只是「純文字組態」而已。  
- **網路地圖（Network Map）節點鎖定**：可鎖定節點與備註，編輯時它們不會再亂跑或被你手滑改變大小。

## 新增
- **IPAM CSV、TSV 與 XLSX 匯出選項**（https://github.com/ryantsai/KKTerm/pull/697）—由 @ryantsai 提供。

## 改善
- **IT Ops 的 Network Map 更新**：包含更多統計顯示，以及 Geomap 尺寸欄位（帶驗證）與在多語系下的支援。
- **Network Map Designer**：強化 Geomap 的動態尺寸與屬性調整處理。
- **短暫截圖編輯 + 啟動路徑處理**：
  - 允許編輯/儲存不會持久化到截圖資料庫的短暫截圖。
  - 支援用命令列傳入的檔案/資料夾開啟；並使用短暫的 Tab，避免視圖選項或子連線 Tab 被保留下來。

## 修正
- **Network Map 鎖定狀態的搜尋與選取行為**：
  - 鎖定的節點/備註會被畫布變更忽略，且會被納入 Network Map 搜尋條件。
  - 選取管理也支援鎖定項目的情境選單操作。
- **本地化維護**：
  - 移除過時的本地化檔案，並更新多語系翻譯以提升一致性/正確性（包含 zh-TW）。

## Internal
- **IT Ops 與 Network Map 的本地化/文件與素材**整理。
- **新增/更新測試**：涵蓋網路地圖鎖定行為、Geomap 版面/畫布變更、IPAM 匯出，以及啟動路徑與短暫截圖的行為。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.134/kkterm-0.1.134-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.134/kkterm-0.1.134-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.134/kkterm-0.1.134-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.134/kkterm-0.1.134-windows-arm64-portable.zip)

## Highlights
- Reconnect actions for **SSH** and **Telnet** now show at the right time (after a disconnection), so your **Connection** toolbar won’t pull a “reconnect wizard” trick early.

## New
- Added **SSH** and **Telnet** reconnect menu actions.  
  - PR #694 by @ryantsai

## Improved
- **Connection** toolbar controls now respond correctly on first click.  
  - PR #696 by @ryantsai

## Fixed
- Reconnect menu actions are shown as **Reconnect** only after the connection is disconnected (instead of before).  
  - Commit: f9a47ba

## Internal
- Refactored child **Connection** handling to better manage layout while preserving **Pane** state (including related tests and docs).  
  - Commit: 1ef86b9
- Preserved terminal renderer/runtime and layout ancestry when closing child **Connections** (including Split layout and Strict Mode scenarios).  
  - Commits: 7cbd1ee, bcad673, ca86263
- Updated connection toolbar activation logic and tests for first-click behavior.  
  - Commits: 1b2445a

---

## 精選重點
- **SSH** / **Telnet** 的重新連線（Reconnect）動作現在會在**斷線之後**才顯示；你的 **Connection** 就不會在還沒「斷」之前就開始叫你重連——這次網路小精靈終於守規矩了。

## 新增
- 新增 **SSH** 與 **Telnet** 的重新連線（Reconnect）選單動作。  
  - PR #694 由 @ryantsai 負責

## 改善
- **Connection** 工具列控制項：現在首次點擊也能正確啟用。  
  - PR #696 由 @ryantsai 負責

## 修正
- 重新連線選單動作只會在**斷線後**才以 **Reconnect** 顯示（不再過早出現）。  
  - Commit：f9a47ba

## Internal
- 重構子 **Connection** 處理方式：更好地管理版面（layout），並保留 **Pane** 狀態（含相關測試與文件）。  
  - Commit：1ef86b9
- 關閉子 **Connection** 時保留終端機渲染/執行與版面繼承關係（包含 Split 版面與 Strict Mode 情境）。  
  - Commits：7cbd1ee、bcad673、ca86263
- 修正並更新首次點擊工具列啟用行為相關程式與測試。  
  - Commits：1b2445a

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.133/kkterm-0.1.133-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.133/kkterm-0.1.133-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.133/kkterm-0.1.133-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.133/kkterm-0.1.133-windows-arm64-portable.zip)

## Highlights
- **Markdown Notes now use WYSIWYG editing** on the Dashboard, with formatting options (so you can stop typing angle brackets like it’s 2003). ✅
- **Status popups for progress notifications** are now laid out with a wider layout for better readability.

## New
- **Dashboard Notes WYSIWYG enhancements**: added/extended table-related actions and localization for dashboard notes table/row/column operations.
- **File viewer localization + table/search/navigation UI strings** were added to support workspace file viewer features (search, replace, navigation, etc.).

## Improved
- **WYSIWYG styling for Notes**: improved list and heading styles for Markdown notes editing.
- **Dashboard Widget Instance experience**: status/progress popups use a wider layout to reduce “squint-and-guess” syndrome during long-running tasks.

## Fixed
- **Progress notification status popup layout**: enhanced to use a wider layout. (PR #692)
- **Dynamic background interaction**: updated dynamic backgrounds to **ignore pointer clicks and presses** (so your background can’t “steal” your clicks).
- **Animated gradient config**: use a constant for the default animated gradient configuration and updated tests.

## Internal
- Refactored the IT Ops module terminology and removed deprecated automation-related UI/code:
  - Automation editor / Automations tab were removed, with related state management cleaned up.
  - “Automations” terminology was renamed to **“Monitors”** across the IT Ops module.
- Removed deprecated localization files for the file viewer and notes.
- WYSIWYG editor/table/file-viewer work included updated/added tests around toolbar actions, soft-wrap behavior, and editor stability.

---

## 亮點（Highlights）
- **儀表板的 Markdown Notes 了改用 WYSIWYG 編輯**，支援多種格式化選項（不用再手動敲著符號排版，像在回到 2003）。✅  
- **進度通知的狀態彈窗**現在改成較寬的版面，閱讀更清楚。

## 新增（New）
- **Dashboard Notes 的 WYSIWYG 強化**：擴充並新增表格相關操作（例如表格/列/欄）的儀表板筆記動作與在地化。
- **檔案檢視器相關在地化**：補上 workspace file viewer 功能的 UI 字串（搜尋、取代、導覽等）。

## 改善（Improved）
- **Notes 的 WYSIWYG 樣式**：改良清單與標題的樣式，讓 Markdown 編輯體驗更一致。
- **Dashboard Widget Instance 使用體驗**：進度/狀態彈窗改用較寬版面，減少「邊瞇眼邊猜」的情況。

## 修正（Fixed）
- **進度通知狀態彈窗版面**：改成較寬的版面以提升可讀性。（PR #692）
- **動態背景互動**：更新動態背景，讓它們**忽略滑鼠點擊與按壓**（背景不會再搶你的滑鼠點）。  
- **動態漸層設定**：對預設的動態漸層設定改用常數，並更新測試。

## 內部（Internal）
- IT Ops 模組進行整理：  
  - 移除了 Automation editor / Automations tab，以及相關狀態管理與自動化樣式。  
  - 將 IT Ops 模組中的「Automations」術語改為 **「Monitors」**，並同步更新一致性與測試。
- 移除檔案檢視器與筆記已淘汰的在地化檔案。
- WYSIWYG、表格與檔案檢視器相關工作也包含更新/新增測試：工具列動作、軟換行行為、與編輯器穩定性等。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.132/kkterm-0.1.132-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.132/kkterm-0.1.132-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.132/kkterm-0.1.132-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.132/kkterm-0.1.132-windows-arm64-portable.zip)

## Highlights
- **Scheduled shutdown timer**: Add/adjust timer behavior so the warning window opens with a full grace period (Cancel gets its whole minute).  
- **Global Quick Command Bundles (Terminal)**: Quick Commands are no longer locked to a single Connection—edit a bundle once and have it apply anywhere it’s selected.  
- **IT Ops: IPAM + Network Map backend + designer upgrades**: Expand IT Ops with new IPAM and Network Map capabilities, including richer Network Map authoring and interaction improvements.  

## New
- **Scheduled shutdown timer** (scheduled shutdown timer) — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/680  
- **IPAM and Network Map backend for IT Ops** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/681  
- **Custom header editor** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/683  
- **Global Quick Command Bundles (Terminal)** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/684  
- **Network Map device catalog + status indicators** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/688  
- **IT Ops VLAN records, per-strand parallel links, and VLAN spotlight overlay** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/689  
- **Network Map designer enhancements** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/690  
- **Network Map canvas interactions improvements** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/691  

## Improved
- **Localize Componentry background labels** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/686  
- **Showcase screenshots and dynamic backgrounds (docs)** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/685  
- **Hero Geometric background animation fix** — by @ryantsai in https://github.com/ryantsai/KKTerm/pull/682 *(a small animation got unstuck—network links are still way more stubborn)*  

## Fixed
- **Scheduled shutdown timer warning grace period and warning-window ACL**  
  - Fixes the warning deadline so you can still cancel during the full grace period.  
  - Adds the missing `shutdown-warning` window capability so status updates work as expected.  
  - (Fix authored by the scheduled shutdown timer PR work; co-authored by Claude Opus 5 in https://claude.ai/code/session_01UYr8pvpvtF1xThZNnQi6UD; PR not provided in the supplied context.)  

## Internal
- Update regex in **Collapse All** test to correctly match `useCallback` pattern (bdbe597).  
- Refactor IT Ops Network Map code structure and related tests (multiple changes; example SHAs: 61cc3bf, eeb2298, c5efffc).  
- Terminal background handling updates for maximized Pane/shared background ownership and transparency/padding rendering (e.g., c67d0f6, f55446c, and related changes in the same v0.1.132 range).  

---

## Highlights（重點）
- **排程式關機計時器**：調整警告視窗開啟時機與宽限期，確保 **Cancel 一定有完整 1 分鐘**（系統才不會像釋放版的網管一樣秒跳）。  
- **終端機全域 Quick Command Bundles**：Quick Commands 不再只能綁在單一 **Connection**；編輯一次 bundle，就能套用到所有使用它的地方。  
- **IT Ops：IPAM + Network Map 後端與設計器強化**：擴充 IT Ops 的能力，包含更豐富的 Network Map 編輯與互動。  

## New（新增）
- **排程式關機計時器**（scheduled shutdown timer）— 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/680  
- **IT Ops 的 IPAM 與 Network Map 後端** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/681  
- **自訂標頭編輯器** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/683  
- **全域 Quick Command Bundles（終端機）** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/684  
- **Network Map 裝置目錄擴充與狀態指示** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/688  
- **IT Ops VLAN 記錄、每股絕緣線（strand）平行鏈路、以及 VLAN spotlight 覆蓋** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/689  
- **Network Map 設計器強化** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/690  
- **Network Map canvas 互動改進** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/691  

## Improved（改進）
- **本地化 Componentry 背景標籤** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/686  
- **展示截圖與動態背景（文件）** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/685  
- **Hero Geometric 背景動畫修正** — 由 @ryantsai 於 https://github.com/ryantsai/KKTerm/pull/682 *(小動畫終於乖了；但 Network Link 通常更固執)*  

## Fixed（修正）
- **排程式關機計時器：警告宽限期與警告視窗 ACL**  
  - 修正警告期限：在警告視窗真正開啟後重新錨定時間，確保可在宽限期內取消。  
  - 新增缺失的 `shutdown-warning` 視窗能力（capability），讓狀態更新能正常運作。  
  - （本次修正由排程式關機相關 PR 的工作內容完成；供應的上下文中未提供對應 PR 編號；並在 https://claude.ai/code/session_01UYr8pvpvtF1xThZNnQi6UD 內提到由 Claude Opus 5 共同撰寫。）  

## Internal（內部）
- 更新 **Collapse All** 測試的 regex，以正確符合 `useCallback` pattern（bdbe597）。  
- 重構 IT Ops Network Map 相關程式結構與測試（多處變更；範例 SHA：61cc3bf、eeb2298、c5efffc）。  
- 終端機背景處理更新：支援最大化 **Pane** 的共用背景所有權，以及透明度/內距渲染（例如 c67d0f6、f55446c，以及同一版本區間內的相關變更）。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.131/kkterm-0.1.131-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.131/kkterm-0.1.131-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.131/kkterm-0.1.131-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.131/kkterm-0.1.131-windows-arm64-portable.zip)

## Highlights
- Improved SFTP transfer integrity and error handling for better reliability (SFTP compression is disabled in SFTP Sessions—because corrupted streams are not a great “feature”).  
- New screenshot draft workflow so you can work on an image without immediately committing it to the library.

## New
- Add download folder settings and download status messages for files downloaded from URL Connections.
- Screenshot enhancements:
  - New screenshot delivery command (`deliver_screenshot_data_url`) and settings-aware delivery to the library.
  - Screenshot draft functionality (read/save/delete drafts; “Draft” label in the UI).
- Add IT Ops, Install Helper, Screenshots, and Watchdogs modules with localization support.
- SaveAsIcon support across multiple areas (dashboard widgets, screenshot editor/page, and workspaces).

## Improved
- Updated native context menu and Settings search to improve download folder options.
- Improved settings popup navigation layout and scrolling behavior.

## Fixed
- Enhanced SFTP transfer integrity and error handling; disabled SSH compression in SFTP sessions.
- Upgraded russh (0.61.2 -> 0.62.4) to pull in upstream fixes affecting Session handling (including client-triggerable Session handler panics, channel close compliance, and kex guess handling) as part of PR https://github.com/ryantsai/KKTerm/pull/678 (by @ryantsai, merged via https://github.com/ryantsai/KKTerm/commit/2d9a3c9 short SHA references not available in provided context).

## Internal
- chore(ssh): upgrade russh 0.61.2 -> 0.62.4 on the stabilized RustCrypto line (https://github.com/ryantsai/KKTerm/pull/678).
- Translate UI strings to Simplified/Traditional Chinese and update icon imports for consistency/accuracy (includes i18n files: `zh-CN.json`, `zh-TW.json`).
- Installer: enhance automatic check throttling and detection persistence across relaunches.
- Refactor: clarify command parameter naming in multiple functions.

---

## 重點
- 強化 SFTP 傳輸完整性與錯誤處理，讓可靠度更好（在 SFTP Session 中停用 SSH 壓縮——因為壞掉的串流不是什麼「特色」）。  
- 新增截圖草稿流程：在不立刻提交到截圖庫前先整理、編修。

## 新增
- 新增下載資料夾設定，以及針對 URL Connection 下載檔案的下載狀態訊息。
- 截圖功能增強：
  - 新的截圖交付指令 `deliver_screenshot_data_url`，以及支援設定感知的方式交付到截圖庫。
  - 截圖草稿功能（支援讀取/儲存/刪除草稿；介面提供「Draft」標籤）。
- 新增 IT Ops、Install Helper、Screenshots、Watchdogs 等模組，並加入多語系在地化支援。
- 支援 SaveAsIcon（套用到儀表板 Widget、截圖編輯器/頁面，以及工作區等多處）。

## 改進
- 更新原生情境選單與「設定」搜尋，讓下載資料夾選項更好找。
- 改善設定彈出視窗的導覽版面與捲動行為。

## 修正
- 強化 SFTP 傳輸完整性與錯誤處理；在 SFTP Session 中停用 SSH 壓縮。
- 升級 russh（0.61.2 -> 0.62.4）以納入上游修正，影響 Session 處理（包含：客戶端觸發的 Session handler panic、channel close 相容性、kex guess 處理），作為 https://github.com/ryantsai/KKTerm/pull/678 的一部分（@ryantsai；合併資訊見提供的上下文）。

## Internal
- chore(ssh)：在穩定的 RustCrypto 路線上升級 russh 0.61.2 -> 0.62.4（https://github.com/ryantsai/KKTerm/pull/678）。
- 將 UI 字串翻譯到簡中/繁中，並更新 icon 匯入以提升一致性與正確性（含 `zh-CN.json`、`zh-TW.json` 等 i18n 檔）。
- 安裝程式：強化自動檢查節流與重新啟動後的偵測持久性。
- 重構：在多個函式中更新指令參數命名以提升可讀性。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.130/kkterm-0.1.130-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.130/kkterm-0.1.130-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.130/kkterm-0.1.130-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.130/kkterm-0.1.130-windows-arm64-portable.zip)

## Highlights
- Remote Desktop: Add full-screen RDP and VNC sessions (with connection-aware full-screen requests).  
- macOS: Improve shortcut display names and fix Tauri updater signing-key normalization.  
  (Because your release pipeline shouldn’t faceplant on base64 like a startled terminal.)

## New
- Remote Desktop: Full-screen RDP and VNC sessions.

## Improved
- macOS: Use macOS modifier names in shortcut displays (PR #673).
- Remote Desktop: Enhanced full-screen handling to include Connection name in requests (PR #676).

## Fixed
- Fixed: Normalize Tauri updater signing key to standard base64 (PR #674) — reported by @ryantsai (linked issue reporter #675).
- macOS shortcut-related signing key test updates (PR #673).

## Internal
- Release/packaging & updater signing adjustments:
  - Normalize updater signing key for macOS packaging scripts (PR #674).
  - Update tests and scripts related to macOS signing key behavior (PR #673).

---

## 重點
- 遠端桌面（Remote Desktop）：新增全螢幕的 RDP 與 VNC Session（同時讓全螢幕請求帶上連線資訊）。  
- macOS：改善快捷鍵顯示方式，並修正 Tauri 更新程式的簽名金鑰編碼。  
 （畢竟釋出流程不該被 base64 絆倒成驚慌的終端機。）

## 新功能
- 遠端桌面：新增全螢幕 RDP 與 VNC Session。

## 改進
- macOS：快捷鍵顯示改用 macOS 的修飾鍵名稱（PR #673）。
- 遠端桌面：強化全螢幕處理，使請求包含 Connection 名稱（PR #676）。

## 修正
- 修正：將 Tauri 更新程式簽名金鑰正規化為標準 base64（PR #674）—並由 @ryantsai 回報（linked issue reporter #675）。
- macOS：快捷鍵相關簽名金鑰測試更新（PR #673）。

## 內部變更
- 發佈/封裝與更新程式簽名相關調整：
  - 更新 macOS 封裝腳本的 updater 簽名金鑰正規化（PR #674）。
  - 更新與 macOS 簽名金鑰行為相關的測試與腳本（PR #673）。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.129/kkterm-0.1.129-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.129/kkterm-0.1.129-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.129/kkterm-0.1.129-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.129/kkterm-0.1.129-windows-arm64-portable.zip)

## Highlights
- New **Misty Sea** dynamic wallpaper with configurable wave scale and star density.
- Selective import now properly sets up the **encrypted store** (master password prompt and consistent credentials), and the installer dialog refreshes **per tool** (so one package doesn’t make the whole fleet look busy).

## New
- Add a setting to **open screenshots in the built-in editor after capture**.
- Misty Sea dynamic wallpaper: added the base Misty Sea option.
- Install Helper: scope checks so the “retrieving…” placeholder is shown for the **tool being checked**.
- Installer: add direct bootstrap option for the Chocolatey installer and enhance PowerShell script execution.

## Improved
- Dashboard dynamic background: Misty Sea now supports configurable **wave scale** and **star density**.
- Installer: scope the installer dialog refresh state **per tool**.
- Sensitive settings import: reconcile secret backend on selective import so the UI and runtime stay in sync.

## Fixed
- Selective import + encrypted store setup: when importing a `.kkbackup` that carries passwords, KKTerm now follows the imported encrypted store selection at runtime, prompts for the machine’s master password when needed, and writes decrypted secrets into the correct store.

## Internal
- Docs(roadmap): audit against codebase and add IT Ops WinRM/SNMP roadmap items (PR #667 by @ryantsai): https://github.com/ryantsai/KKTerm/pull/667
- Add Misty Sea dynamic wallpaper (PR #669 by @ryantsai): https://github.com/ryantsai/KKTerm/pull/669
- Scope Install Helper retrieving placeholder to the tool being checked (PR #671 by @ryantsai): https://github.com/ryantsai/KKTerm/pull/671
- Support encrypted store setup during selective import (PR #672 by @ryantsai): https://github.com/ryantsai/KKTerm/pull/672
- Refactor/test tooling around installer/provider selection, macOS IME handling, and various test updates.

---

## 精選重點
- 新增 **Misty Sea** 動態壁紙，支援可調整波浪比例與星星密度。
- 選擇性匯入（Selective import）現在能正確設定 **加密儲存庫**（必要時會要求主密碼，且憑證會一致），同時安裝器對話框也會**依工具**刷新（避免一個工具讓整台終端看起來像在忙翻天）。

## 新增
- 新增設定：**截圖儲存後自動用內建編輯器開啟**。
- Misty Sea 動態壁紙：加入 Misty Sea 選項。
- 安裝助手：將「retrieving…（正在取得）」提示**限制在實際正在檢查的那個工具**上顯示。
- 安裝器：Chocolatey 新增 direct bootstrap 選項，並強化 PowerShell 指令執行。

## 改善
- 儀表板動態背景：Misty Sea 支援可調整的 **波浪比例**與**星星密度**。
- 安裝器：安裝器對話框刷新狀態改為**依工具**處理。
- 選擇性匯入的敏感設定：在匯入時正確對應 secret backend，讓 UI 與實際執行保持一致。

## 修正
- 選擇性匯入 + 加密儲存庫：當匯入帶有密碼的 `.kkbackup` 時，KKTerm 會在執行階段正確跟隨匯入的加密儲存庫選項；必要時會提示輸入這台裝置的主密碼，並將解密後的密碼寫入正確儲存庫。

## Internal
- Docs(roadmap)：針對程式碼庫進行稽核並加入 IT Ops WinRM/SNMP 路線圖項目（PR #667 by @ryantsai）：https://github.com/ryantsai/KKTerm/pull/667
- 新增 Misty Sea 動態壁紙（PR #669 by @ryantsai）：https://github.com/ryantsai/KKTerm/pull/669
- 將安裝助手的「retrieving…」提示範圍限制到**正在檢查的工具**（PR #671 by @ryantsai）：https://github.com/ryantsai/KKTerm/pull/671
- 支援選擇性匯入時進行加密儲存庫設定（PR #672 by @ryantsai）：https://github.com/ryantsai/KKTerm/pull/672
- 針對安裝器/提供者選擇、macOS IME 處理與各項測試更新等進行內部重構與測試調整。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.128/kkterm-0.1.128-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.128/kkterm-0.1.128-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.128/kkterm-0.1.128-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.128/kkterm-0.1.128-windows-arm64-portable.zip)

## Highlights
- **Screenshots Module**: New capture options for **auto border** and (Windows UI) **include cursor**.  
- **Screenshot editor**: A more complete editing flow—**live annotation layer**, **crop & tools**, and **configurable keyboard shortcuts**. (Your clipboard finally gets to rest.)
- **Installer (uv)**: Better detection of **Astral uv** installation by reading its receipt from the config directory. If uv is installed, KKTerm should stop pretending it isn’t.

## New
- **Screenshots Module**: Settings for **auto capture border** and **include cursor**.  
  - PR #651
- **Screenshot editor**: **Configurable keyboard shortcuts** under **Settings → Shortcuts → Screenshot editor** (Copy / Save / Save As).  
  - PR #665
- **Notes widget**: **Cut / Copy / Paste** context menu, improved paste handling, and Markdown line-breaks.  
  - PR #661
- **Settings → Export/Import**: Consolidated export/import categories, with **table-style per-Connection passwords**.  
  - PR #663
- **Installer (uv)**: Updated logic to detect Astral uv install receipt from its config directory.  
  - PR #666

## Improved
- **Screenshot editor UI**: Compact editor chrome and updated control visuals (e.g., icons).  
  - PR #657, PR #656
- **Screenshot editor tools**: Annotation layer workflow with **color/stroke pickers**, **inline text**, and **select tool**.  
  - PR #662
- **Screenshots capture behavior**: Keep shortcut and tray screenshot captures visible.  
  - PR #659
- **Screenshots Module capture flow**: Guard React event reads in state updaters (helps keep Session/Tab UI state from getting “out of sync”).  
  - PR #655
- **Settings reliability**: Preserve partial selective imports (less “oops, lost my selective import”).  
  - PR (fix) in commit: `beaf129` (fix(settings): preserve partial selective imports)
- **Passwords export/import UX**: Consolidation in the UI grouping while keeping bundle segments compatible across app versions.  
  - PR #663

## Fixed
- **uv version/install detection**: Read Astral uv receipt from its config directory, improving detection even when the receipt isn’t adjacent to `uv.exe`.  
  - Fix for issues reported by **@jfphi** (issue #664, issue #633)  
  - PR #666
- **Screenshot editor**: Fix copy/save icons.  
  - PR #656 (and related)
- **Screenshot editor**: Focus editor for keyboard shortcuts.  
  - PR #665 (keyboard shortcuts), plus fix `ca81a9b` (“fix(screenshots): focus editor for keyboard shortcuts”)
- **Installer**: Respect Chocolatey default for installer bundles.  
  - PR #660
- **React state updates**: Guard React event reads in state updaters.  
  - PR #655

## Internal
- **Release CI**: Raise Windows release job timeout to 300m.  
  - PR #658
- **Release workflow**: Skip Cloudflare mirror for draft/prerelease (exit cleanly instead of failing).  
  - commit `224d1bd`
- **React safety / refactor**: Refactor code structure for readability and maintainability.  
  - commit `60f5144`
- **Portable/ID constants**: Share portable marker filename constant across app and CLI, and share bundle identifier constant across app and CLI.  
  - PR #653, PR #654
- **Installer robustness**: Persist check attempt timestamps to avoid repeated retries on provider outages.  
  - commit `c4a8851`
- **Localization / docs / tooling**: Various internal localization updates and related docs/test adjustments across the release.  
  - multiple commits (e.g., `3f0236c` for localization refactor)

---

## Highlights（重點）
- **Screenshots 模組**：新增擷取選項：**自動加邊框**與（Windows 介面）**包含游標**。
- **截圖編輯器**：更完整的編輯流程—**即時標註圖層**、**裁剪與工具**、以及**可設定的鍵盤快捷鍵**。（剪貼簿終於可以休息一下。）
- **安裝程式（uv）**：改善對 **Astral uv** 安裝的偵測，會改從設定目錄讀取 receipt。若 uv 已安裝，KKTerm 也應該不會再裝死說「沒安裝」。  

## New（新增）
- **Screenshots 模組**：提供**自動擷取邊框**與**包含游標**的設定。  
  - PR #651
- **截圖編輯器**：在 **設定 → 快捷鍵 → Screenshot editor** 可設定鍵盤快捷鍵（複製 / 儲存 / 另存新檔）。  
  - PR #665
- **Notes Widget**：**剪下 / 複製 / 貼上**情境選單、改善貼上處理，以及 Markdown 換行行為。  
  - PR #661
- **設定 → 匯出/匯入**：整併匯出/匯入分類，並將**每個 Connection 的密碼**以表格樣式呈現。  
  - PR #663
- **安裝程式（uv）**：更新邏輯以從設定目錄讀取 Astral uv 安裝 receipt 進行偵測。  
  - PR #666

## Improved（改善）
- **截圖編輯器 UI**：更精簡的編輯器外觀與控制視覺（例如圖示）。  
  - PR #657、PR #656
- **截圖編輯器工具**：標註圖層工作流程，支援**顏色/線條粗細選擇**、**內嵌文字**與**選取工具**。  
  - PR #662
- **截圖行為**：保留快捷鍵與工具列（tray）截圖的可見性。  
  - PR #659
- **Screenshots 擷取流程**：在 state updater 中保護 React 事件讀取（讓 Session/Tab 的 UI 狀態更不容易不同步）。  
  - PR #655
- **設定匯入**：保留部分選擇性匯入結果。  
  - PR（fix）在 commit：`beaf129`（fix(settings): preserve partial selective imports）
- **匯出/匯入密碼體驗**：UI 分組整併，同時保持 bundle segments 跨版本兼容。  
  - PR #663

## Fixed（修正）
- **uv 版本/安裝偵測**：從設定目錄讀取 Astral uv receipt，改善在 `uv.exe` 旁邊沒有 receipt 時的偵測。  
  - 針對由 **@jfphi** 回報的問題修正（issue #664、issue #633）  
  - PR #666
- **截圖編輯器**：修正複製/儲存圖示。  
  - PR #656（以及相關）
- **截圖編輯器**：修正鍵盤快捷鍵的焦點行為。  
  - PR #665（鍵盤快捷鍵），以及 commit `ca81a9b`（fix(screenshots): focus editor for keyboard shortcuts）
- **安裝程式**：遵循 Chocolatey 預設的安裝套件行為。  
  - PR #660
- **React state 更新**：在 state updaters 中保護 React 事件讀取。  
  - PR #655

## Internal（內部）
- **Release CI**：將 Windows 發佈工作（job）逾時調高到 300 分鐘。  
  - PR #658
- **Release 流程**：對 draft/prerelease 跳過 Cloudflare mirror，改為乾淨退出不失敗。  
  - commit `224d1bd`
- **重構/可讀性**：重構程式結構以提升可讀性與可維護性。  
  - commit `60f5144`
- **可攜/識別常數**：共用可攜 marker 檔名常數（app 與 CLI 同步），以及共用 bundle identifier 常數（app 與 CLI 同步）。  
  - PR #653、PR #654
- **安裝程式健壯性**：保留檢查嘗試的時間戳，避免在 provider 當機時反覆重試。  
  - commit `c4a8851`
- **本地化/文件/測試**：本版包含多項內部本地化更新與文件/測試調整。  
  - 多個 commit（例如 `3f0236c`：本地化重構）

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.127/kkterm-0.1.127-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.127/kkterm-0.1.127-windows-arm64-setup.exe)
* 📦 [Portable for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.127/kkterm-0.1.127-windows-x64-portable.zip)
* 📦 [Portable for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.127/kkterm-0.1.127-windows-arm64-portable.zip)

## Highlights
- Centralized **Saved Credentials** management (and stopped duplicate credentials) for smoother Connection auth. (`#648`, by @ryantsai; issue reporter: dec04)
- Windows **portable mode** with a creation wizard. (`#646`, by @ryantsai)
- Screenshot capture upgrades: **xcap** is now the default capture engine with a fallback path when accelerated capture isn’t available. (`#649`, by @ryantsai)
- Region capture + library pagination fixes. (`#647`, by @ryantsai)

## New
- Add Windows portable mode and creation wizard for preparing a portable setup. (`#646`, by @ryantsai)

## Improved
- **Saved Credentials**: manage them centrally and stop duplicates; Connections can link to the right Saved Credential instead of silently multiplying them. (`#648`, by @ryantsai; issue reporter: dec04)

## Fixed
- Repair region capture and library pagination in screenshots. (`#647`, by @ryantsai)
- Portable copy wizard: drop retired legacy columns when creating a portable copy. (`#650`, by @ryantsai)

## Internal
- Validate all required platforms before publishing release manifest. (`#644`, by @ryantsai)
- Fix: don’t publish partial Cloudflare manifests during staggered releases. (`e6118f7`)

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.126/kkterm-0.1.126-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.126/kkterm-0.1.126-windows-arm64-setup.exe)

## Highlights
- **Install Helper tiles now have a tile-level _Run_ button** with launch surfaces tailored to the tool type (GUI / CLI / web / coreutils), plus **brand icons** (Chrome/Firefox/Acrobat Reader, etc.)—so running tools feels less like spelunking through menus.  
- **AI Assistant gains Cursor Agent CLI support** via ACP (agent acp), including install helper entries and Cursor CLI backend wiring.  
- **Workspace management tools** (list/create/rename/reorder/delete) integrated into the AI assistant + connection handling, with workspace-aware connection creation.

## New
- **Install Helper**
  - Add **Cursor Agent CLI** to Install Helper (recipe/catalog + icon assets).
  - Add **Kimi Code CLI** and **Grok Build** to the installer catalog with official CLI support.
  - Add install-planning doc for **portable mode** (`docs/PORTABLE.md`).
  - Add **Obsidian** and **Audacity** to the Install Helper catalog.
- **AI Assistant**
  - Add **Cursor Agent CLI backend** for Cursor support (ACP/agent acp).
- **RDP / Connections**
  - Add **administrative session option** and **support multiple shared local folders** in RDP settings.

## Improved
- **Install Helper UI**
  - Refresh the installer launcher and details access for **terminal launch** (unified access in installed details and tile actions).
  - Remember coding agent **launch folders** for more consistent terminal starts.
  - Add enhanced launcher flow for **coding agent options** (common flags + additional arguments + GUI app selection when auto resolution fails).
  - Refresh “latest version” per tool.
  - Improve styling/layout consistency for installer components.
- **AI / Connections**
  - Update connection descriptions and Cursor CLI prompts across multiple languages.

## Fixed
- **Install Helper**
  - Fix **WinGet updates** for **externally installed apps**.
  - Detect **Astral standalone uv installs** in Install Helper when WinGet ARP misses script installs (**#633**, PR https://github.com/ryantsai/KKTerm/pull/638; reported by @jfphi).
- **AI**
  - Fix **AI CLI detection** with refreshed `PATH` (PR https://github.com/ryantsai/KKTerm/pull/642).

## Internal
- Refactor installer run logic and routing around centralized run action.
- Update terminal launcher behavior for Windows GUI subsystem (ShellExecute).
- Handle null values for optional fields in OpenAI responses.
- Various installer/icon/catalog/localization updates and test adjustments.

---

## 發行重點
- **安裝助手（Install Helper）的每個磁貼（tile）新增「執行（Run）」按鈕**，並依照工具類型切換對應的啟動方式（GUI / CLI / Web / coreutils），同時也補上多種**品牌圖示**（Chrome/Firefox/Acrobat Reader 等）——讓「要怎麼啟動來著？」少一點、找得到多一點。
- **AI 助理新增 Cursor Agent CLI 支援**：透過 ACP（agent acp）串接 Cursor 的 CLI 後端，也包含安裝助手的相關條目。
- **工作區（Workspace）管理工具**（列表/建立/重新命名/調整順序/刪除）整合到 AI 助理與連線處理流程中，並支援在建連線時關聯工作區。

## 新增
- **安裝助手（Install Helper）**
  - 將 **Cursor Agent CLI** 加入 Install Helper（recipe/catalog + 圖示資產）。
  - 將 **Kimi Code CLI** 與 **Grok Build** 加入安裝目錄，並支援官方 CLI 偵測。
  - 新增 **portable mode 規劃文件**（`docs/PORTABLE.md`）。
  - 在安裝目錄加入 **Obsidian** 與 **Audacity**。
- **AI 助理**
  - 新增 **Cursor Agent CLI 後端**以支援 Cursor（透過 ACP/agent acp）。
- **RDP / 連線（Connections）**
  - 新增 **管理員工作階段（administrative session）**選項，並支援 **多個共用的本地資料夾**。

## 改善
- **安裝助手 UI**
  - 統一已安裝細節（installed details）與磁貼動作中，終端機（terminal）啟動的入口。
  - 記住編碼代理（coding agent）的**啟動資料夾**，讓 Session / Terminal 啟動更一致。
  - 在啟動器流程中加入更完整的**編碼代理選項**（常用旗標 + 其他參數 + 當自動解析失敗時可選 GUI 應用）。
  - 針對每個工具更新「最新版本」。
  - 改善安裝助手元件的樣式與視覺一致性。
- **AI / 連線（Connections）**
  - 更新多語系的連線描述與 Cursor CLI 提示文字。

## 修正
- **安裝助手（Install Helper）**
  - 修正 **WinGet 更新**：避免針對**外部安裝（externally installed）**的應用更新出問題。
  - 修正 **Astral standalone uv** 在 Install Helper 無法正確偵測的問題（PR https://github.com/ryantsai/KKTerm/pull/638；問題回報者 @jfphi，對應 #633）。
- **AI**
  - 修正 **AI CLI 偵測**：透過更新 `PATH` 讓偵測更可靠（PR https://github.com/ryantsai/KKTerm/pull/642）。

## Internal
- 針對安裝器的 Run 邏輯進行重構，集中化與路由調整。
- 調整 Windows GUI 子系統的終端機啟動行為（ShellExecute）。
- 修正 OpenAI 回應中選用欄位的 null 值處理。
- 其他安裝/圖示/目錄/在地化與測試更新。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.125/kkterm-0.1.125-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.125/kkterm-0.1.125-windows-arm64-setup.exe)

## Highlights
- **New:** Duplicate a **Connection** with UI + localization (so you don’t have to re-enter everything like it’s 3AM on a terminal).
- **New Web tools:** Added **webview** context menu actions, including **Open link in new Tab**, **Copy link address**, **Copy selected text**, and **Capture page to Clipboard** (full-page capture supported).
- **Fixed:** Paste confirmation is now kept **above URL panes** (and the split-URL-pane z-order won’t get tangled).

## New
- **Installer productivity catalog:** Added **Chrome, Firefox, and Acrobat Reader** to the Install Helper productivity catalog. ([#626](https://github.com/ryantsai/KKTerm/pull/626) by @ryantsai)
- **Connections:** Added **connection duplication** feature with UI integration and localization. ([#632](https://github.com/ryantsai/KKTerm/pull/632) (not available), commit `2ed47f7`)
- **WebView workspace:** Enhanced context menu actions for navigating/copying/saving from the webview, plus **full-page capture** support. (commit `119cf96`)
- **IT Ops:** Added **Server Room blackout** easter egg and related animations. (commit `a747743`)

## Improved
- **Native command handling:** Offloaded expensive native commands. ([#627](https://github.com/ryantsai/KKTerm/pull/627) by @ryantsai)
- **SFTP UX:** Refactored the **SFTP** context menu to use the native context menu implementation. (commit `4c51a7c`)
- **WinGet installer logic:** Updated WinGet installation logic to improve recipe detection and alias handling. (commit `9ac7234`)
- **Performance + efficiency:** Improved several areas including performance monitoring, panel resizing, and file sorting. (commit `e2decd9`)

## Fixed
- **Z-order:** Fixed **paste confirmation** z-order over split URL **panes** and ensured paste confirmation stays above URL panes. ([#630](https://github.com/ryantsai/KKTerm/pull/630) by @ryantsai; commit `e665f98`)
- **Session stability:** Restored lost serialization when commands moved off the main thread (includes serialization via worker-side locks and serialized VcXsrv control). (commit `70eb599`, Co-Authored-By: Claude Fable 5)

## Internal
- Updated/install-related docs and installer catalog artifacts for detection/managed-service coverage. (commit `77587ca`, `10bebe8`)
- Performance monitoring and app logic refactors plus tests supporting the improvements. (commit `e2decd9`)
- Added/regenerated installer and related test coverage for new features. (various commits)

---

## 重點摘要
- **新增：** 支援在介面中**複製 Connection**（不用再像半夜在終端機一樣，重複手動輸入一遍）。
- **新增 Web 工具：** 強化 **webview** 內容選單動作：**在新分頁開啟連結**、**複製連結位址**、**複製已選文字**、**截圖並複製頁面到剪貼簿**（支援全頁）。
- **修正：** **貼上確認視窗**會維持在 **URL 分頁（panes）**之上，避免被層級（z-order）打亂。

## 新增
- **安裝助手（Install Helper）效率工具目錄：** 將 **Chrome、Firefox、Acrobat Reader** 加入。([#626](https://github.com/ryantsai/KKTerm/pull/626) by @ryantsai)
- **Connections：** 新增 **Connection 複製**功能（含介面整合與在地化）。([#632](https://github.com/ryantsai/KKTerm/pull/632)（無法取得 PR 連結資訊）, commit `2ed47f7`)
- **WebView 工作區：** 強化 webview 內容選單（導覽/複製/儲存），並加入**全頁截圖**支援。 (commit `119cf96`)
- **IT Ops：** 加入 **Server Room blackout** 彩蛋與相關動畫。 (commit `a747743`)

## 改進
- **原生命令處理：** 將昂貴的原生命令轉移到離線處理（offload）。([#627](https://github.com/ryantsai/KKTerm/pull/627) by @ryantsai)
- **SFTP 使用體驗：** 將 **SFTP** 的內容選單改為使用原生內容選單實作。 (commit `4c51a7c`)
- **WinGet 安裝邏輯：** 更新 WinGet 安裝判斷方式，提升 recipe 偵測與別名（alias）處理。 (commit `9ac7234`)
- **效能/效率：** 多處效能與效率面向改善（包含面板縮放邏輯、檔案排序等）。 (commit `e2decd9`)

## 修正
- **層級（z-order）：** 修正貼上確認在分割的 URL **panes** 上方顯示層級問題，並確保貼上確認維持在 URL panes 之上。([#630](https://github.com/ryantsai/KKTerm/pull/630) by @ryantsai；commit `e665f98`)
- **Session 穩定性：** 修復在命令移出主執行緒後造成的序列化遺失（包含 worker 端鎖、以及序列化 VcXsrv 控制）。(commit `70eb599`, Co-Authored-By: Claude Fable 5)

## Internal
- 更新/調整安裝與偵測相關文件與安裝器目錄檔案。 (commit `77587ca`, `10bebe8`)
- 支援效能與功能改進的內部重構與測試。 (commit `e2decd9`)
- 新功能相關的安裝器與測試覆蓋補強。 (各種提交)

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.124/kkterm-0.1.124-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.124/kkterm-0.1.124-windows-arm64-setup.exe)

## Highlights
- **SSH Connection**: “Auto trust new host key” is now enabled by default—no more trust prompts for newly seen hosts (your network admin brain can finally rest).  
- **Durable UI state**: Connection/Tab/Dashboard Widget Instance-related UI state is now stored with an SQLite-backed approach, and a reset race was fixed.

## New
- **Install Helper**: Added an installer default provider setting in Settings.
- **Install Helper recipes**: Added **KeePassXC** to Install Helper.
- **Installer sections**: Added **Multimedia** and **Productivity** sections to the installer.

## Improved
- **URL overlay**: Improved lifecycle behavior so the **URL overlay** stays correctly visible after reload.
- **Settings search**: Enhanced search result highlighting and localization support (including indexing + UI enhancements).
- **IT Ops**: Improved background handling and context menu interactions.
- **IT Ops room viewport**: Enhanced panning and centering features.
- **IT Ops cloning workflow**: Improved shift-click instructions and cloning interactions for floor plan / ISO views.
- **Duplication (IT Ops)**: Enhanced duplication for Server Rooms and Racks (including prefilled properties for Server Rooms during duplicate, and richer rack duplication parameters).
- **Live Session Tab activation (Activity Rail)**: Improved correct **Tab** activation for live Sessions before child-layout reconstruction.

## Fixed
- **Selective workspace replace default**: Fixed the selective workspace replace default behavior.
- **Hide AI shell command windows**: External AI shell command windows are now hidden.
- **Durable UI state reset race**: Fixed a reset race in the durable UI state flow.

## Internal
- Localization updates across multiple locales (installer settings, IT Ops hints, and settings search wording).
- Terminal recording export now uses unique file names with incremental suffixes.
- IT Ops tests and settings search tests updated/added to match the improved behaviors.
- Webview handling changes to suppress F5 reload in the main shell while keeping the URL overlay available when needed.  

---

## 版本 v0.1.124 精選重點
- **SSH Connection**：預設已啟用「自動信任新的主機金鑰」——新增主機不再一直跳出信任提示（你的網管腦終於可以稍微喘口氣了）。
- **持久化 UI 狀態**：與 **Connection**、**Tab**、以及 **Dashboard Widget Instance** 相關的 UI 狀態改為使用 SQLite 作為儲存方案，並修正了重置競態問題。

## 新增
- **Install Helper**：在設定中新增「安裝助手預設提供者」設定項。
- **Install Helper 配方**：新增 **KeePassXC** 到 Install Helper。
- **安裝程式分類**：安裝程式新增 **多媒體（Multimedia）** 與 **生產力（Productivity）** 兩個區塊。

## 改進
- **URL overlay**：強化 URL overlay 的生命週期行為，讓 **重新載入後** URL overlay 能維持正確可見。
- **設定搜尋**：改善搜尋結果高亮顯示與在地化支援（包含索引與 UI 互動增強）。
- **IT Ops**：改善背景處理與內容選單（context menu）互動。
- **IT Ops 房間視窗（room viewport）**：加強平移（panning）與置中（centering）體驗。
- **IT Ops 複製/克隆流程**：改善地面平面/ISO 視圖的 Shift-Click 操作指引與互動體驗。
- **複製（IT Ops）**：強化伺服器機房與機櫃（Server Rooms / Racks）的複製功能（例如：機房複製時會先開啟可預填的 Properties；機櫃複製支援更多參數）。
- **Activity Rail：Live Session 的 Tab 啟用**：改善 **Live Session 的 Tab** 在子版面重建前就能正確啟用。

## 修正
- **選擇性工作區（selective workspace replace）預設值**：修正選擇性工作區取代的預設行為。
- **隱藏 AI shell 指令視窗**：隱藏外部的 AI shell 指令視窗。
- **持久化 UI 狀態重置競態**：修正 durable UI state 重置流程中的競態問題。

## Internal
- 多語系在地化更新（包含安裝程式設定、IT Ops 提示、與設定搜尋文案）。
- 更新/新增測試以符合 IT Ops 與設定搜尋的改進行為。
- 終端機錄製匯出改為使用遞增後綴的唯一檔名。
- Webview 處理調整：抑制主 Shell 的 F5 重新載入，同時保留 URL overlay 在需要時可用。

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.123/kkterm-0.1.123-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.123/kkterm-0.1.123-windows-arm64-setup.exe)

## Highlights
- Smarter Connection + Session defaults for faster desk-to-terminal workflows (auto-record, right-click paste, and auto-trust host keys).
- Better terminal recording handling: fixes for Windows garbling and general recording rendering hardening.
- IT Ops got more complete AI assistant/MCP parity, including navigation and highlight coverage. (IT ops is where the network meets the paperwork.)

## New
- Add auto-record, right-click paste, and auto-trust host key options by @ryantsai in https://github.com/ryantsai/KKTerm/pull/610
- Add auto-record, right-click paste, and auto-trust host key options by @ryantsai in https://github.com/ryantsai/KKTerm/pull/610
- Add auto-record, right-click paste, and auto-trust host key options by @ryantsai in https://github.com/ryantsai/KKTerm/pull/610
- Support more MobaXterm import types by @ryantsai in https://github.com/ryantsai/KKTerm/pull/608
- Add hmac-sha1 to legacy SSH compatibility mode by @ryantsai in https://github.com/ryantsai/KKTerm/pull/614
- Enhance terminal recordings model + UI: column resizing and new recording dialog elements by @ryantsai in https://github.com/ryantsai/KKTerm/pull/612
- feat(itops): full AI assistant/MCP parity, IT Ops navigation, and highlight coverage by @ryantsai in https://github.com/ryantsai/KKTerm/pull/609
- Selective import: close tabs when replacing workspaces and sync workspaces/connections actions by @ryantsai in https://github.com/ryantsai/KKTerm/pull/611
- Update Codex desktop installer to ChatGPT Desktop (Codex) and adjust detection by @ryantsai in https://github.com/ryantsai/KKTerm/pull/606

## Improved
- Use disk icon for URL credential save by @ryantsai in https://github.com/ryantsai/KKTerm/pull/603
- Remember active tab per workspace by @ryantsai in https://github.com/ryantsai/KKTerm/pull/604
- Optimize hex viewer decoding and rendering by @ryantsai in https://github.com/ryantsai/KKTerm/pull/613

## Fixed
- Fix garbled terminal recordings on Windows by @ryantsai in https://github.com/ryantsai/KKTerm/pull/612
- Fix selective import replace tab cleanup by @ryantsai in https://github.com/ryantsai/KKTerm/pull/611
- Fix itops assistant/MCP review gaps (harden assistant and MCP review gaps) by @ryantsai in https://github.com/ryantsai/KKTerm/pull/609
- Fix itops: delete a Server Room's racks with the room by @ryantsai in https://github.com/ryantsai/KKTerm/pull/609

## Internal
- Optimize hex viewer decoding and rendering by @ryantsai in https://github.com/ryantsai/KKTerm/pull/613 (work also touched tests and related resources)
- Update localization files for multiple languages and improve test assertions by @ryantsai (commit: 155bfad)

---

## 重點摘要
- 更聰明的 Connection / Session 預設值：支援自動錄製、右鍵貼上、以及自動信任主機金鑰，讓日常流程少點手動開關（就像把網路線直接插好一樣）。
- 終端機錄製處理更可靠：修正 Windows 上終端機錄製畫面變形的問題，並強化一般錄製渲染。
- IT Ops 補齊了 AI 助理 / MCP 的功能對齊，包含導覽與高亮覆蓋。（在 IT Ops 的世界裡，網路與文書總要一起跑。）

## 新增
- 新增自動錄製、右鍵貼上、以及自動信任主機金鑰選項（Auto-record / right-click paste / auto-trust host keys）by @ryantsai in https://github.com/ryantsai/KKTerm/pull/610
- 支援更多 MobaXterm 匯入類型 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/608
- 為舊版 SSH 相容模式加入 hmac-sha1 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/614
- 終端機錄製模型 + 介面強化：支援欄位調整寬度，並新增錄製對話框相關元素 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/612
- feat(itops): 完整的 AI 助理/MCP 對齊、IT Ops 導覽與高亮覆蓋 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/609
- 選擇性匯入：在取代 Workspace 時關閉分頁，並同步 workspace / connections 相關動作 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/611
- 更新 Codex 桌面安裝器為 ChatGPT Desktop (Codex)，並調整偵測方式 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/606

## 改進
- URL 憑證儲存改用磁碟機圖示 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/603
- 每個 workspace 記住目前作用中的分頁（Tab） by @ryantsai in https://github.com/ryantsai/KKTerm/pull/604
- 優化 hex viewer 的解碼與渲染 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/613

## 修正
- 修正 Windows 上終端機錄製內容變形（garbled） by @ryantsai in https://github.com/ryantsai/KKTerm/pull/612
- 修正選擇性匯入在取代分頁時的清理問題 by @ryantsai in https://github.com/ryantsai/KKTerm/pull/611
- 修正 itops 助理/MCP 審閱缺口（harden assistant and MCP review gaps）by @ryantsai in https://github.com/ryantsai/KKTerm/pull/609
- 修正：刪除 Server Room 時，同步刪除該房間內的機櫃/機架（racks）by @ryantsai in https://github.com/ryantsai/KKTerm/pull/609

## Internal
- 優化 hex viewer 解碼與渲染（同時也影響到相關測試與資源）by @ryantsai in https://github.com/ryantsai/KKTerm/pull/613
- 更新多語系翻譯檔並改進測試斷言 by @ryantsai（commit：155bfad）

## Direct Downloads
* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.122/kkterm-0.1.122-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.122/kkterm-0.1.122-windows-arm64-setup.exe)

## Highlights
- Import and export of Selective backup data is now more consistent with the stored schema (less “missing pieces” in the KKTerm box).
- Kuai Kuai device notes can be rendered as tiny “handwriting” on the note panel, so your Rack notes don’t stay invisible.
- IT Ops Rack Devices can use fractional widths that share a single U row (e.g., two devices in one U), with placement hardened so metadata won’t end up half-saved when a move/resize is rejected.

## New
- Fractional-width Rack Devices can share a single U row (supports half/quarter width with left/right slots).  
  PR #600 (by @ryantsai)
- Scribble device notes onto the Kuai Kuai note panel.  
  PR #601 (by @ryantsai)

## Improved
- Preserve Kuai Kuai note layout so intentional blank lines remain on their corresponding ruled lines.  
  PR #596 (by @ryantsai)
- More reliable MobaXterm connection import: Session type is now read from params (not the icon number).  
  PR #598 (by @ryantsai)
- Harden fractional rack placement behavior.  
  PR #600 (via @ryantsai)  
  (includes preventing partial metadata saves when a resize/reject happens)

## Fixed
- Fix serial port dropdown clipping on macOS.  
  PR #599 (by @ryantsai)

## Internal
- No user-facing changes listed beyond the items above.

---

## 亮點
- 精選匯出/匯入（Selective backup）與儲存的資料結構（stored schema）一致性更好，較不會出現「缺了一段但你又說不出是哪段」的狀況。
- Kuai Kuai 裝置筆記可以以小字「手寫感」呈現在記事面板上，讓你在機櫃（Rack）裡的備註不再只剩文字尷尬地躺著。
- IT Ops 的機櫃裝置（Rack Devices）支援分數寬度共用同一個 U（例如一個 U 放兩台），同時強化擺放流程，避免在移動/調整被拒絕時導致中途儲存的後設資料（metadata）半成品。

## 新增
- 分數寬度的機櫃裝置可以共用單一 U 列（支援 half/quarter 寬度，並使用左右槽位 left/right slots）。  
  PR #600（由 @ryantsai 負責）
- 在 Kuai Kuai 記事面板上把裝置筆記「潦草塗寫」上去。  
  PR #601（由 @ryantsai 負責）

## 改進
- 保留 Kuai Kuai 筆記版面：讓你刻意保留的空白行，仍會落在對應的格線（ruled lines）上。  
  PR #596（由 @ryantsai 負責）
- 提升 MobaXterm 連線匯入可靠度：Session 類型改從 params 讀取（不再依賴 icon number）。  
  PR #598（由 @ryantsai 負責）
- 強化分數寬度機櫃擺放（fractional rack placement）的行為。  
  PR #600（由 @ryantsai）  
  （包含在 resize/拒絕時避免只儲存一半的後設資料問題）

## 修正
- 修正 macOS 上序列埠（serial port）下拉選單裁切（clipping）問題。  
  PR #599（由 @ryantsai 負責）

## 內部
- 本次沒有額外列出超出上述範圍的使用者可感知變更。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.121/kkterm-0.1.121-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.121/kkterm-0.1.121-windows-arm64-setup.exe)

## Highlights

- **RDP Clipboard (macOS/Linux canvas):** Pasting now sends your **local clipboard contents** into the **remote Session** again—no more “nothing happens” after Ctrl/Cmd+V. (IronRDP-based)
* **RDP stability & focus:** Improved handling for **Window/overlay focus** and more reliable **HWND realization**, plus better diagnostics when the canvas focus gets temperamental.
* **Session workflow polish:** Preserved **SSH forwards** when changing **tmux** panes; improved **RDP scaling** for Windows text size.

## New

- **IronRDP CLIPRDR clipboard redirection for canvas RDP** (<https://github.com/ryantsai/KKTerm/pull/584>)
* **Legacy SSH key-exchange support for older servers** (<https://github.com/ryantsai/KKTerm/pull/592>)
* **Server room partition wall objects** (<https://github.com/ryantsai/KKTerm/pull/594>)

## Improved

- **RDP input handling & diagnostics for macOS/Linux** (<https://github.com/ryantsai/KKTerm/pull/590>)
* **Retry URL webview HWND realization** to avoid transient failures (<https://github.com/ryantsai/KKTerm/pull/590>)
* **Fix RDP overlay handling for connection import dialog** (<https://github.com/ryantsai/KKTerm/pull/589>)
* **RDP ActiveX focus repair + canvas focus diagnostics** (<https://github.com/ryantsai/KKTerm/pull/591>)
* **Honor legacy SSH protocol choice in IT Ops batch runs** (<https://github.com/ryantsai/KKTerm/pull/592>)
* **Preserve SSH forwards after tmux pane changes** (<https://github.com/ryantsai/KKTerm/pull/586>)

## Fixed

- **Paste local clipboard into remote on macOS/Linux canvas RDP** — credited to @ryantsai (<https://github.com/ryantsai/KKTerm/pull/582>)
  * *Sysadmin humor:* Ctrl/Cmd+V should now behave like it’s actually plugged into the network, not just “waiting patiently” on the desktop.
* **Fix RDP scaling with Windows text size** — credited to @ryantsai (<https://github.com/ryantsai/KKTerm/pull/585>)
* **Fix RDP overlay handling for connection import dialog** — credited to @ryantsai (<https://github.com/ryantsai/KKTerm/pull/589>)

## Internal

- Bumped/updated dependencies and code quality improvements (rusqlite, sha2, aes-gcm, and more), plus installer-related adjustments and refactors in RDP/SSH-related modules.  
* Merge commits included in this release: #582–#594 (see changelog link: <https://github.com/ryantsai/KKTerm/compare/v0.1.120...v0.1.121>)

---

## Highlights（重點）

- **RDP 剪貼簿（macOS/Linux 的 Canvas）**：現在重新把**本機剪貼簿內容**送到**遠端 Session** 了；不再出現按下 Ctrl/Cmd+V 後**什麼都沒發生**的情況。（基於 IronRDP）
* **RDP 穩定性與焦點**：改善 **Window/overlay 焦點**處理、讓 **HWND realization** 更可靠，並加強在 Canvas 焦點變得難搞時的**診斷資訊**。
* **工作流程微調**：tmux 分割視窗切換後會保留 **SSH forwards**；也修正了 Windows 字體大小導致的 **RDP 縮放**問題。

## New（新增）

- **IronRDP CLIPRDR 剪貼簿重新導向（Canvas RDP）**（<https://github.com/ryantsai/KKTerm/pull/584）>
* **支援較舊伺服器的 Legacy SSH key-exchange**（<https://github.com/ryantsai/KKTerm/pull/592）>
* **伺服器機房分隔牆物件**（<https://github.com/ryantsai/KKTerm/pull/594）>

## Improved（改善）

- **macOS/Linux 的 RDP 輸入處理與診斷**（<https://github.com/ryantsai/KKTerm/pull/590）>
* **重試 URL webview 的 HWND realization**，避免短暫失敗（<https://github.com/ryantsai/KKTerm/pull/590）>
* **修正連線匯入對話框的 RDP overlay 處理**（<https://github.com/ryantsai/KKTerm/pull/589）>
* **RDP ActiveX 焦點修復 + Canvas 焦點診斷**（<https://github.com/ryantsai/KKTerm/pull/591）>
* **IT Ops 批次作業中遵守 Legacy SSH 協定選項**（<https://github.com/ryantsai/KKTerm/pull/592）>
* **tmux 分割視窗切換後保留 SSH forwards**（<https://github.com/ryantsai/KKTerm/pull/586）>

## Fixed（修正）

- **macOS/Linux Canvas RDP：把本機剪貼簿貼到遠端** — 感謝 @ryantsai（<https://github.com/ryantsai/KKTerm/pull/582）>
  * *小小系統工程師冷笑話：*現在 Ctrl/Cmd+V 真的會把內容送上網，不再只是「在桌面上乖乖等著」。  
* **修正 Windows 字體大小造成的 RDP 縮放** — 感謝 @ryantsai（<https://github.com/ryantsai/KKTerm/pull/585）>
* **修正連線匯入對話框的 RDP overlay 處理** — 感謝 @ryantsai（<https://github.com/ryantsai/KKTerm/pull/589）>

## Internal（內部）

- 更新/調整相依套件與程式碼品質（rusqlite、sha2、aes-gcm 等），以及在 RDP/SSH 相關模組中的 refactor 與安裝器調整。  
* 本版包含的 merge commit：#582–#594（完整差異見：<https://github.com/ryantsai/KKTerm/compare/v0.1.120...v0.1.121）>

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.120/kkterm-0.1.120-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.120/kkterm-0.1.120-windows-arm64-setup.exe)

## Highlights

- **Settings keyboard shortcuts are now customizable** (and your key presses should route correctly this time—no more “terminal ate my shortcut”).  
* **IT Ops Module** is **shown by default** on the Activity Rail for new installs (and revealed for upgrades), so you don’t have to hunt for it like a lost network cable.
* **AI assistant skill list** no longer forces **horizontal overflow** in Settings.

## New

- **Customizable keyboard shortcut settings** in **Settings → Shortcuts**. (PR #574 by @ryantsai)
* **Show IT Ops Module on Activity Rail by default**. (PR #580 by @ryantsai)

## Improved

- **IT Ops**: The rack storage disk array is kept within device bounds (render as a fixed-size grid). (PR #577 by @ryantsai)
* **IT Ops**: Icon picker popover no longer gets clipped in Sheet-based dialogs (e.g., IT Ops “Edit Site” / “Edit Server Room”). (PR #578 by @ryantsai)
* **IT Ops**: Rack item dialog header styling improvements. (sha: 15d9314)

## Fixed

- **Shortcut event routing regressions** are fixed. (PR #575 by @ryantsai)
* **Stop sudo playbook leaking password and skipping later nodes** by redacting sudo secrets and preventing echoed command mismatches. (PR #576 by @ryantsai)
* **Settings**: AI assistant skill list no longer overflows horizontally. (PR #579 by @ryantsai)

## Internal

- IT Ops PDF export improvements (non-ASCII handling, room zoom fitting, graphical rack representations, and related tests). (sha: 5f03d3f, sha: f62cf7d)
* IT Ops: Enhance Task Library (new columns, edge picker, OS/task display improvements, localization, and tests). (sha: 45c5067, sha: dc8c37c)
* Rack item tools enhanced for `kuaiguai` kind (metadata/validation). (sha: a857949)
* Updated translations/documentation for IT Ops task status columns across multiple languages. (sha: e45c634)
* Additional test coverage for agent tool subturn limits and notice messages. (sha: 200f566)

---

## 重點摘要

- **「設定」中的鍵盤快捷鍵現在可自訂**（而且快捷鍵分發也修好了——這次不會再發生「終端機把我的快捷鍵吃了」這種事）。  
* **IT Ops 模組**會在 **活動軌道（Activity Rail）預設顯示**：新安裝預設開啟，升級則會揭示出來，免得你像在找散落的網路線那樣到處翻。  
* **設定裡的 AI 助理技能清單**不再強制橫向溢出。

## 新增

- **設定可自訂鍵盤快捷鍵**：**設定 → 快捷鍵（Shortcuts）**。 (PR #574 by @ryantsai)
* **預設在活動軌道顯示 IT Ops 模組**。 (PR #580 by @ryantsai)

## 改善

- **IT Ops**：機櫃儲存磁碟陣列會保持在裝置範圍內（以固定大小網格呈現）。 (PR #577 by @ryantsai)
* **IT Ops**：圖示選擇器（icon picker）彈出視窗不再被 Sheet 型對話框裁切（例如 IT Ops「編輯站點 / 編輯機房」）。 (PR #578 by @ryantsai)
* **IT Ops**：機櫃項目對話框標題樣式調整。 (sha: 15d9314)

## 修正

- **修復快捷鍵事件路由的回歸問題**。 (PR #575 by @ryantsai)
* **停止 sudo playbook 洩漏密碼並跳過後續節點**（包含遮罩/清除 sudo 秘密與避免回顯命令比對錯誤）。 (PR #576 by @ryantsai)
* **設定**：AI 助理技能清單不再橫向溢出。 (PR #579 by @ryantsai)

## Internal

- IT Ops PDF 匯出改進（非 ASCII 處理、房間縮放適配、圖形化機櫃呈現與相關測試）。 (sha: 5f03d3f, sha: f62cf7d)
* IT Ops：強化 Task Library（新增欄位、邊緣插入選擇器、OS/任務顯示改善、在地化與測試）。 (sha: 45c5067, sha: dc8c37c)
* 機櫃項目工具支援 `kuaiguai` 種類（更新中繼資料/驗證）。 (sha: a857949)
* 多語言更新任務狀態欄位翻譯與文件。 (sha: e45c634)
* 針對 agent 工具 subturn limits 與通知訊息增加測試覆蓋。 (sha: 200f566)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.119/kkterm-0.1.119-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.119/kkterm-0.1.119-windows-arm64-setup.exe)

## Highlights

* **Connection:** Left-aligned the “no active session” connection hint links so they don’t look like they took a wrong turn in the layout. (PR #568 by @ryantsai)

* **VNC:** Improved VNC Connection security-type negotiation by skipping unknown security types, helping **UltraVNC** servers connect. (PR #570 by @ryantsai; issue reported by @qazq in #569)

## New

* **IT Ops:** The IT Ops Module is now officially released and shows on the Activity Rail by default. Fresh installs and upgrades reveal it automatically; anyone who prefers it hidden can still turn it off in **Settings → IT Ops**. (by @ryantsai)
* **IT Ops:** Exposed IT Ops topology tools to the AI assistant and the built-in MCP server. (PR #573 by @ryantsai)

## Improved

* **IT Ops:** Server Room elevations edit mode now uses the shared device picker (same feel as Rack view, minus the extra detours). (PR #571 by @ryantsai)

* **IT Ops:** Server Room room elevations edit mode now renders the device picker correctly (no more empty picker card grid). (PR #572 by @ryantsai)

## Fixed

* **Connection:** Left-align connection hint links in empty workspace. (PR #568 by @ryantsai)

* **VNC:** Skip unknown security types during handshake so UltraVNC servers can connect. (PR #570 by @ryantsai; issue reported by @qazq in #569)
* **IT Ops:** Room elevations device picker rendered empty. (PR #572 by @ryantsai)

## Internal

* Updated connection handling test assertions. (190ee88)

* Added/updated localization content for multiple UI strings and empty hints across languages. (5609022, 1344f58, 8b1375b, 4e96961, a4c4d90, a80236b)  
* Merge / reconcile updates across main branches. (11c63e3, 3eb4eca, 2a84a42, e90f512, f080828, 6?8b?/* see context commits)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.118/kkterm-0.1.118-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.118/kkterm-0.1.118-windows-arm64-setup.exe)

## Highlights

* **IT Ops:** Host inventory now supports **hostname import**, **connectivity scan**, and **rack callouts**.

* **IT Ops:** Rack View placement got more “cursor-aware” — with **armed device placement** and improved picker preview cards.
* **Terminal:** WezTerm-inspired terminal features landed, but **prompt navigation + copy-last-command-output UI are hidden** until shell integration can be injected (otherwise the menu would be a ghost on a LAN).  

## New

* **IT Ops Host inventory**: add Host inventory with hostname import, connectivity scan, and rack callouts (**#560** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/560>

* **IT Ops Terminal room/isometric placement foundations** (isoPlacementCells + edit-mode placement targets) (**#561** landed as part of the WezTerm-inspired work stream)  
* **Object Picker preview cards**: full-width preview cards for IT Ops object picker (**#564** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/564>
* **Kuai Kuai device kind label + Rack item dialog refactor** (**#565** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/565>
* **Kuai Kuai rack-top unification + expiry fade** (**#567** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/567>
* **Terminal upgrades (WezTerm-inspired)**: OSC 133 navigation, Quick Select, inline images, terminal notifications, hyperlink rules, and terminal color schemes (**#561** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/561>
* **Connection / Workspace empty state improvement**: enhance empty state with connection creation options (**PR #292809e series work**)  

## Improved

* **Rack View picker UX**: full-width picker cards and placement cursor ghost fixes (**#564** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/564>

* **Rack item dialog layout & server panel style options** (**#5443d12 / #5443d12 commit series**)  
* **Rack-top Kuai Kuai consistency across views** + **fade toward expiry** (**#567** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/567>
* **Edit-mode placement flow**: cursor ghost + object placement support in room views (**#5a198c0**)  

## Fixed

* **IT Ops Site View dot grid** and **off-screen Rack Device dialog**, plus **cursor-tracked device placement** (**#563** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/563>

* **Cursor-tracked device placement preview issues** and **off-screen cursor ghost** were addressed alongside the picker improvements (**#564** by @ryantsai; contributor credited in PR history as Claude Fable)  
  <https://github.com/ryantsai/KKTerm/pull/564>
* **Terminal menu/source guard**: realign stale Document Connection menu source guard (**#49b113a**)

## Internal

* Removed outdated localization entries/files related to IT Ops and Terminal settings (**d9caef8 / 64e789f / 3f574b4 series**).

* Installer: enhanced Krita detection and improved installer list layout (**2a1940f**).
* AI model defaults updated to GPT-5.6 Luna and Grok 4.5 support (**eafb382**).
* **Internal prompt navigation + terminal integration groundwork** (pre-UI removal/visibility changes) (**3f574b4**, PR **#566** by @ryantsai)  
  <https://github.com/ryantsai/KKTerm/pull/566>

---

## 亮點

* **IT Ops：** 主機清單（Host inventory）新增 **主機名稱匯入**、**連線/連通性掃描**，以及 **機櫃（Rack）位置呼叫**。

* **IT Ops：** Rack View 的放置流程更「跟得上游標」—提供 **已啟用（armed）的設備放置**與更好的選擇器預覽卡。
* **Terminal：** 已加入類 WezTerm 的終端功能，但 **提示導覽（prompt navigation）與「複製上一筆指令輸出」的 UI 先隱藏**，直到可注入 shell integration（不然選單就會變成網路上的幽靈）。  

## 新增

* **IT Ops 主機清單（Host inventory）**：支援主機名稱匯入、連通性掃描、以及 Rack 呼叫（**#560**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/560>

* **IT Ops：室內/等距放置基礎**（isoPlacementCells + 編輯模式放置目標）  
* **物件選擇器預覽卡**：IT Ops 物件選擇器改為**全寬預覽卡**（**#564**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/564>
* **Kuai Kuai 裝置類型標籤 + Rack 物件對話框重構**（**#565**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/565>
* **Kuai Kuai：機櫃頂部統一 + 期限淡出（expiry fade）**（**#567**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/567>
* **Terminal：類 WezTerm 更新**（OSC 133 導覽、Quick Select、內嵌影像、終端通知、超連結規則、終端配色方案）（**#561**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/561>
* **Connection / Workspace：空狀態改善**：強化連線建立選項的空畫面  

## 改進

* **Rack View 選擇器體驗**：全寬卡片與放置游標幽靈修正（**#564**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/564>

* **Rack 物件對話框與伺服器面板樣式選項**（**#5443d12 / #5443d12 commit series**）
* **各視圖一致的 Rack-top Kuai Kuai** + **期限淡出**（**#567**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/567>
* **編輯模式放置流程**：游標幽靈與物件放置支援（**#5a198c0**）

## 修正

* **IT Ops：** Site View 點狀網格、**Rack Device 對話框跑到畫面外**、以及**跟隨游標的設備放置**（**#563**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/563>

* **選擇器相關的游標跟隨預覽問題**與**畫面外游標幽靈**已一併隨選擇器改進處理（**#564**，作者 @ryantsai；PR 歷史中註記 contributor 為 Claude Fable）  
  <https://github.com/ryantsai/KKTerm/pull/564>
* **Terminal 選單/來源保護（guard）**：修正 Document Connection 選單來源保護的舊對應（**#49b113a**）

## Internal

* 清理過時的在地化（localization）條目/檔案（IT Ops 與 Terminal 設定相關）（**d9caef8 / 64e789f / 3f574b4 series**）。

* Installer：強化 Krita 偵測並改善安裝程式清單佈局（**2a1940f**）。
* AI 模型預設更新為 GPT-5.6 Luna，並加入 Grok 4.5 支援（**eafb382**）。
* **Terminal 提示導覽與整合底層準備**（配合 UI 可見性調整前的內部工作）（**3f574b4**，PR **#566**，作者 @ryantsai）  
  <https://github.com/ryantsai/KKTerm/pull/566>

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.117/kkterm-0.1.117-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.117/kkterm-0.1.117-windows-arm64-setup.exe)

## Highlights

* **SFTP / FTP starting folders:** The SSH SFTP browser popup is larger, and standalone FTP/FTPS/SFTP connections can now remember both **Local start path** and **Remote start path** options. (PR #555, #556)

* **Activity Rail Session reuse fixed:** Clicking a connected **Connection** in the Activity Rail while another **Workspace** is active now **returns to the cross-Workspace Session** instead of spawning a new one. (PR #559)

## New

* **IT Ops Site View segments:** Added **Batch Runs** and **Automations** segments to the **Site View** drill toolbar, reusing the appropriate Tab behavior scoped to the selected Site. (PR #557)

* **Automations Site binding:** Automations on a Site now support a durable Site binding (including editor selection and segment filtering). (PR #558)
* **SFTP browser + configurable start folders:** Enlarged SSH SFTP popup and added configurable start folder options for standalone FTP/FTPS/SFTP connections. (PR #555)

## Improved

* **Dashboard AI coding usage:** Refreshed hybrid local-first Codex usage behavior and hardened Claude usage rate-limiting to reduce overly aggressive calls. (PR #558)

* **Connection icon handling & localization:** Enhanced connection icon normalization (including `reicon:` references) and updated IT Ops UI/localization accessibility text. (PR #556)
* **Docs alignment:** Realigned AGENTS, CONTEXT, ARCHITECTURE, and the manual with the current codebase. (PR #556)

## Fixed

* **Activity Rail cross-Workspace Session reuse:** Prevented Activity Rail Connection clicks from spawning new Sessions when a different Workspace was active; reuse now properly scopes the stored Child Connection lookup to the active Workspace, and activating an existing Tab is preferred. (PR #559 — Claude Fable 5)

## Internal

* **SFTP start-path preservation:** Preserved standalone start paths for SFTP/related protocol flows. (PR #555)

* **Tooling/testing:** Made Windows-focused Rust tests pass on non-Windows hosts. (commit 65d e5f3)
* **Docs/content:** Removed deprecated localization files for FTP/SFTP connections and IT Ops. (commit e78f936)
* **Installer / IT Ops enhancements (non-user-facing items included under this release context):** Improved installer process output details and updated layout CSS for IT Ops. (PRs tied to the same v0.1.117 changeset)

---

## Highlights（重點）

* **SFTP / FTP 起始資料夾：** SSH 的 SFTP 瀏覽器彈窗變大；而獨立的 FTP/FTPS/SFTP 連線現在可以記住 **本機起始路徑（Local start path）** 與 **遠端起始路徑（Remote start path）** 的選項。 （PR #555、#556）

* **活動列（Activity Rail）Session 重用修正：** 當另一個 **Workspace** 已啟用時，在 Activity Rail 點選已連線的 **Connection**，現在會**回到跨 Workspace 的 Session**，而不是再生成一個新的 Session。 （PR #559）

## New（新增）

* **IT Ops Site View 分段：** 在 **Site View** 的 drill 工具列加入 **Batch Runs** 與 **Automations** 分段，並沿用對應的 Tab 行為，且會依所選 Site 進行範圍限制。 （PR #557）

* **Automations Site 綁定：** Site 的 Automations 現在支援耐久的 Site 綁定（包含編輯器選擇與分段篩選）。 （PR #558）
* **SFTP 瀏覽器 + 可設定起始資料夾：** 放大 SSH SFTP 彈窗，並為獨立 FTP/FTPS/SFTP 連線加入可設定的起始資料夾選項。 （PR #555）

## Improved（改進）

* **Dashboard AI 程式碼使用量：** 更新 hybrid local-first Codex 行為，並強化 Claude 使用量的 rate-limit，避免過度頻繁的呼叫。 （PR #558）

* **連線圖示處理與在地化：** 強化連線圖示的正規化（支援 `reicon:` 參照），並更新 IT Ops 介面與可近用性的文字（accessibility）。 （PR #556）
* **文件對齊：** 讓 AGENTS、CONTEXT、ARCHITECTURE 與手冊內容與目前程式碼重新對齊。 （PR #556）

## Fixed（修正）

* **活動列跨 Workspace 的 Session 重用：** 避免在另一個 Workspace 啟用時，Activity Rail 的 Connection 點擊會不必要地生成新的 Session；現已正確把已儲存的 Child Connection 查找範圍限制在「目前啟用的 Workspace」，並在存在既有 Tab 時會優先切換。 （PR #559 — Claude Fable 5）

## Internal（內部）

* **SFTP 起始路徑保留：** 保留獨立（standalone）起始路徑以符合 SFTP/相關流程行為。 （PR #555）

* **工具/測試：** 讓原本偏 Windows 的 Rust 測試能在非 Windows 主機上通過。 （commit 65d e5f3）
* **文件/內容：** 移除已廢棄的 FTP/SFTP 連線與 IT Ops 相關在地化檔案。 （commit e78f936）
* **安裝程式 / IT Ops 改善（依本次 release context 放在內部項下）：** 改善安裝程式的程序輸出細節，並更新 IT Ops 版面 CSS。 （與 v0.1.117 相同變更集關聯的 PR）

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.116/kkterm-0.1.116-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.116/kkterm-0.1.116-windows-arm64-setup.exe)

## Highlights

* Fixed SSH port-forwarding loopback-port discovery to reuse the live SSH **Session**, avoiding an extra SSH login that could reset/re-login your original **Terminal** session. (Closes #551 — thanks catyku; PR #552 by @ryantsai)

* Fixed install helper **winget** UAC handling. (PR #549 by @ryantsai)

## New

* N/A

## Improved

* N/A

## Fixed

* **SSH Session reuse for port-forwarding**: Loopback-port discovery now routes through the existing live **Session** instead of creating a second one-shot SSH connection. This prevents network-appliance “one login at a time” behavior from kicking your original session. (Closes #551; PR #552 — @ryantsai; linked reporter: catyku)

* **Installer (winget) UAC handling**: Improved **winget** UAC behavior in the install helper. (PR #549 — @ryantsai)

## Internal

* N/A

---

## 精華重點

* 修正 SSH 連線的埠轉送（port-forwarding）環回埠（loopback-port）偵測：會重用現有的即時 SSH **Session**，避免額外開啟第二次 SSH 登入，從而避免把你原本的 **Terminal** 工作階段踢掉/重登。 （關閉 #551 — 感謝 catyku；PR #552 由 @ryantsai 貢獻）

* 修正安裝助手中的 **winget** UAC 處理。 (PR #549 — @ryantsai)

## 新增

* N/A

## 改善

* N/A

## 修正

* **SSH Session 重用（埠轉送環回埠偵測）**：環回埠偵測改為透過已存在的即時 **Session** 執行，而不是再建立一個額外的 one-shot SSH 連線。這能避免在常見的網路設備上因「同一帳號同時登入次數限制」而導致你原本的工作階段被踢掉。（關閉 #551；PR #552 — @ryantsai；連結的回報者：catyku）

* **安裝器（winget）UAC 處理**：改善安裝助手中的 **winget** UAC 行為。 (PR #549 — @ryantsai)

## 內部

* N/A

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.115/kkterm-0.1.115-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.115/kkterm-0.1.115-windows-arm64-setup.exe)

## Highlights

* Added new Dashboard dynamic backgrounds: **Circuit**, **Halftone**, **Orbitals**, **Ink**, and **Crystals**. (Your Tab/Panes now have more “network-ready” vibes.)

## New

* **Dashboard dynamic backgrounds**: Circuit, Halftone, Orbitals, Ink, Crystals.

* **Localization**: Added i18n localization entries to support the new dynamic backgrounds across languages.

## Improved

* Updated the dynamic backgrounds **registry** to include the new backgrounds.

* Refreshed **tests** to validate the presence and functionality of the new backgrounds.
* Improved code organization by introducing **abstract dynamic backgrounds** for the dynamic background implementation.

## Internal

* Documentation and localization TODO cleanup for dynamic backgrounds (removed unused localization files for dynamic backgrounds).

---

## 亮點（Highlights）

* 新增 Dashboard 動態背景：**Circuit（電路）**、**Halftone（半色調）**、**Orbitals（軌道）**、**Ink（墨水）**、**Crystals（水晶）**。 （你的 Tab/Panes 現在更有「網路就緒」的氛圍。）

## 新增（New）

* **Dashboard 動態背景**：Circuit、Halftone、Orbitals、Ink、Crystals。

* **在地化（Localization）**：為新增的動態背景加入 i18n 對應內容，支援多語系。

## 改善（Improved）

* 更新動態背景 **註冊表（registry）**，納入新的背景。

* 更新 **測試（tests）**，驗證新動態背景的存在性與功能。
* 透過引入 **抽象動態背景（abstract dynamic backgrounds）**，改善動態背景實作的程式碼組織。

## Internal

* 清理動態背景相關的文件與在地化 TODO（移除未使用的動態背景在地化檔案）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.114/kkterm-0.1.114-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.114/kkterm-0.1.114-windows-arm64-setup.exe)

## Highlights

* **Configurable URL user-agent support** (DB, backend, and UI) so your Connection can present the web identity you intend. (PR #548)

## New

* Add **configurable URL user-agent** setting across the app (DB, backend, and UI).  
  <https://github.com/ryantsai/KKTerm/pull/548>

## Improved

* Added/updated **localized strings** for the URL user-agent setting in multiple languages. (7307c0d)

## Fixed

* **WebKit view issues on macOS**. (PR #548, merged via 54a8b53)  
  <https://github.com/ryantsai/KKTerm/pull/548>

## Internal

* Add tests for **dashboard dynamic backgrounds** registration/validation coverage. (64cef41)

---

## 亮點

* **支援可自訂 URL User-Agent**（DB、後端與 UI），讓你的 **Connection** 能以你想要的網路身分呈現。 (PR #548)

## 新增

* 新增 **可自訂 URL User-agent** 設定，覆蓋整個應用（DB、後端與 UI）。  
  <https://github.com/ryantsai/KKTerm/pull/548>

## 改善

* 對 URL User-agent 設定的**多語系在地化字串**進行新增/更新。 (7307c0d)

## 修正

* **修正 macOS 上 WebKit View 的問題**。 (PR #548，透過 54a8b53 合併)  
  <https://github.com/ryantsai/KKTerm/pull/548>

## Internal

* 新增測試，覆蓋 Dashboard **動態背景** 的註冊/驗證流程。 (64cef41)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.113/kkterm-0.1.113-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.113/kkterm-0.1.113-windows-arm64-setup.exe)

## Highlights

* **IT Ops Server Room views**: Improved how racks/room objects sit in both the floor plan and 2.5D views—no more “floating beside the rack” vibes.

* **Linux stability**: Fixed AppImage build/signing conflicts and stopped AppImage environment variables from leaking into spawned host processes.
* **Remote Desktop / Codex**: Routed IronRDP canvas assistant controls correctly.

## New

* Added **Reicon icon names** (including fallback/legacy names) to the icon catalog picker.

## Improved

* **IT Ops**: Added more physically grounded rendering for **Dashboard Widget Instance** server room visuals—rack footprints and room objects now better reflect depth/size expectations in Server Room views.

## Fixed

* **Linux (AppImage)**: Resolve conflicting signer private-key args during AppImage build. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/538>, short SHA: ee7e769)

* **Linux (AppImage runtime)**: Stop AppImage env leaking into spawned host processes, fixing issues like host VM detection and mis-loaded libraries. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/539>, short SHA: 75f84cb)
* **IT Ops**: Settle room objects against resolved rack cells; remove iso debug telemetry. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/542>, short SHA: 20173b3)
* **IT Ops**: Keep elevated 2.5D object sprites visually planted on their support. *(Issue reporter: @Claude Fable 5, via Co-Authored-By)* (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/543>, short SHA: 462cbe2)
* **IT Ops**: Use Reicon cabinet and server room icons. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/544>, short SHA: ff8f715)
* **IT Ops**: Bottom-align 2.5D object artwork inside its sprite box. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/545>, short SHA: 6148f85)
* **Codex / IronRDP**: Fix IronRDP canvas assistant routing. *(Issue reporter: @ryantsai)* (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/546>, short SHA: b31129d)
* **Linux platform gaps**: App Launcher browser fallback, “Don’t Sleep” behavior, missing host metrics, and RDP routing path fixes. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/541>, short SHA: 4347ef0)

## Internal

* Installer/UI polish: share Install Helper module icon. (short SHA: 8a87c38)

* Icon plumbing: refactor/adjust IT Ops icon references and styles for consistent Reicon usage. (short SHA: 7162948)
* IT Ops correctness work: adjust site and rack Reicon defaults + related icon catalog test coverage. (short SHA: 038e2e4)
* Tests/tooling: add/adjust tests for lazy boundaries, platform runtime, and icon catalog integration. (short SHAs: 16d3fbe, tests listed in context)
* (Release engineering) AppImage signing/build step fixes included above. (short SHAs: ee7e769, 1c18ab4, 9930c00)

---

## Highlights

* **IT Ops 机房视图**：改善机架/房间物件在平面与 2.5D 视图中的摆放效果——不再出现「明明贴着机架却像飄在旁边」的尴尬。

* **Linux 稳定性**：修正 AppImage 打包/签名时的私钥参数冲突，并阻止 AppImage 的环境变量外泄到 KKTerm 生成的主机进程。
* **远端桌面 / Codex**：已正确路由 IronRDP 的画布助理控制項。

## New

* 在图示目录选择器中加入 **Reicon 图示名称**（包含备用/旧版名称）。

## Improved

* **IT Ops**：让 Server Room 的渲染更贴近物理深度与尺寸预期——机架足迹与房间物件在 Server Room 视图中的深度/大小表现更一致，适合放进你的 **Dashboard Widget Instance** 里当好视觉证据。

## Fixed

* **Linux（AppImage 打包）**：解决 AppImage 签名器私钥参数冲突。（@ryantsai： <https://github.com/ryantsai/KKTerm/pull/538，短> SHA：ee7e769）

* **Linux（AppImage 執行期）**：阻止 AppImage 環境外泄到被生成的主机进程，修复如主机 VM 判定与套件库误加载等问题。*(“网路像宇宙”一样，环境变量也得管好)*（@ryantsai： <https://github.com/ryantsai/KKTerm/pull/539，短> SHA：75f84cb）
* **IT Ops**：让房间物件对齐到已解析的机架格子；移除 iso 偵錯遥测。（@ryantsai： <https://github.com/ryantsai/KKTerm/pull/542，短> SHA：20173b3）
* **IT Ops**：让抬高状态的 2.5D 物件精灵视觉上保持贴在支撑物上。*(Issue 回报者：@Claude Fable 5，透過 Co-Authored-By)*（@ryantsai： <https://github.com/ryantsai/KKTerm/pull/543，短> SHA：462cbe2）
* **IT Ops**：改用 Reicon 机柜与机房图示。（@ryantsai： <https://github.com/ryantsai/KKTerm/pull/544，短> SHA：ff8f715）
* **IT Ops**：让 2.5D 物件精灵盒内的画面靠下对齐。 （@ryantsai： <https://github.com/ryantsai/KKTerm/pull/545，短> SHA：6148f85）
* **Codex / IronRDP**：修复 IronRDP 画布助理路由。*(Issue 回报者：@ryantsai)*（@ryantsai： <https://github.com/ryantsai/KKTerm/pull/546，短> SHA：b31129d）
* **Linux 平台问题**：App Launcher 浏览器回退、“Don’t Sleep” 行为、主机指标缺失，以及 RDP 路由路径修正。 （@ryantsai： <https://github.com/ryantsai/KKTerm/pull/541，短> SHA：4347ef0）

## Internal

* 安装/界面细节：共享 Install Helper 模块图示。 （短 SHA：8a87c38）

* 图示管线整理：重构/调整 IT Ops 图示引用与样式，以一致使用 Reicon。 （短 SHA：7162948）
* IT Ops 正确性与默认值：调整站点与机架的 Reicon 默认值，并补充相关图示目录测试覆盖。 （短 SHA：038e2e4）
* 测试/工具：加入或调整懒加载、平台运行期与图示目录整合相关测试。 （短 SHAs：16d3fbe，context 中列出的 tests）
* （发布工程）如上所述的 AppImage 打包/签名步骤修复。 （短 SHAs：ee7e769、1c18ab4、9930c00）

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.112/kkterm-0.1.112-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.112/kkterm-0.1.112-windows-arm64-setup.exe)

## Highlights

* **IT Ops Server Room views:** hover detail cards, solid selectable **2.5D floor colours**, and the **rotate stepper relocated under the zoom ruler**.  
  PR #535 by @ryantsai (short SHA: `99c2e99`)

* **IT Ops drill + Site View:** full-bleed drill pane views, free-form **Site View** with **Auto Organize**, and clearer 2.5D readability (no floating kind chips).  
  PR #536 by @ryantsai (short SHA: `d3451cf`)

## New

* **Background media:** added support for **SVG files** in background media handling. (short SHA: `b4e2eb1`)

* **Server Room views:** selection + context menu support, plus updated rack/object property handling. (short SHA: `c629842`)
* **Cursor-tracked placement preview:** added right-click **cancel** functionality in Server Room views. (short SHA: `1e1390a`)
* **SitesTab:** enhanced with expandable tree controls and sidebar actions. (short SHA: `875ae0a`)
* **IT Ops UI text:** added a `properties` translation for multiple languages. (short SHA: `f23bf03`)

## Improved

* **Quick Connect:** refactored the Quick Connect menu to use native menu items and updated localization strings; also flattened local shell menu options and removed nested submenu styling. (short SHA: `1c705bd`, `28e7598`)

* **Recent connections:** added pagination for recent connections and updated localization strings. (short SHA: `79c0df0`)
* **Server Room floor plan (2.5D):** moved rack-unit figures off the view itself and into **hover detail cards**. (short SHA: `5cdbfe5`)
* **Server Room floor plan / Site calculations:** improved state management and optimized server room calculations in SitesTab. (short SHA: `d53b72d`)
* **Server Room IsoView:** solid selectable 2.5D floor colours and moved rotate stepper under the zoom ruler (including updated translations). (short SHA: `4fbe218`)

## Fixed

* **Linux AppImage:** fixed blank window on other hosts caused by bundled `libwayland-*` conflicting with the target machine, plus WebKit DMA-BUF renderer issues on virtualized graphics stacks.  
  PR #537 by @ryantsai (short SHA: `aca963f`) — reported and fixed by **@ryantsai**. (Yes, the sysadmin gremlins were on both ends of the wire.)
  * Resources updated: `docs/LINUX_PORT.md`, `scripts/package-linux.sh`, `src-tauri/src/main.rs`

## Internal

* **Developer experience:** bound Vite and Tailwind source scans to avoid large diagnostic artifacts stalling debug launch. (short SHA: `4bc6e16`)

* **Input tests:** enhanced input-autocorrect policy tests for Quick Connect fields. (short SHA: `67ce515`)
* **Localization workflow:** updated localization guidelines for handling new/changed keys. (short SHA: `c6d0801`)

---

## Highlights（繁體中文-台灣）

* **IT Ops 機櫃機房（Server Room）檢視：** 顯示滑入細節卡（hover detail cards）、可選的**實心 2.5D 地板顏色（solid 2.5D floor colours）**，以及**旋轉步進器（rotate stepper）改到縮放尺（zoom ruler）下方**。  
  PR #535 由 @ryantsai（短 SHA：`99c2e99`）

* **IT Ops 鑽取（drill）+ Site View：** 全寬（full-bleed）的 drill 面板檢視、支援**自由擺放的 Site View**（含 **Auto Organize**），並提升 2.5D 可讀性（移除漂浮的物件種類標籤）。  
  PR #536 由 @ryantsai（短 SHA：`d3451cf`）

## New（新增）

* **背景媒體：** 背景媒體處理新增 **SVG 檔支援**。 （短 SHA：`b4e2eb1`）

* **Server Room 檢視：** 新增選取狀態與情境選單（context menu），並更新機櫃/物件屬性處理方式。 （短 SHA：`c629842`）
* **游標追蹤擺放預覽：** 在 Server Room 檢視加入右鍵**取消**功能。 （短 SHA：`1e1390a`）
* **SitesTab：** 增強為支援可展開的樹狀控制項與側邊欄動作。 （短 SHA：`875ae0a`）
* **IT Ops 翻譯字串：** 新增多語系的 `properties` 翻譯。 （短 SHA：`f23bf03`）

## Improved（改進）

* **Quick Connect：** 重構 Quick Connect 選單改用原生選單項，並更新在地化字串；同時也展平本機 shell 選單選項、移除巢狀子選單的樣式。 （短 SHA：`1c705bd`、`28e7598`）

* **最近連線（recent connections）：** 新增近期連線分頁（pagination），並更新在地化字串。 （短 SHA：`79c0df0`）
* **Server Room 地板平面 / 2.5D：** 將機櫃單位高度（rack-unit figures）從檢視本體移除，改由**滑入細節卡（hover detail cards）**呈現。 （短 SHA：`5cdbfe5`）
* **SitesTab 計算/狀態：** 改善狀態管理並最佳化 SitesTab 中的 server room 計算。 （短 SHA：`d53b72d`）
* **Server Room IsoView：** 實心可選的 2.5D 地板顏色、並將旋轉步進器移到縮放尺下方（含翻譯更新）。 （短 SHA：`4fbe218`）

## Fixed（修正）

* **Linux AppImage：** 修正其他主機上啟動後出現空白視窗的問題：原因是 AppImage 內建的 `libwayland-*` 與目標主機的環境衝突，另外也修正虛擬化圖形堆疊上的 WebKit DMA-BUF 繪製問題。  
  PR #537 由 @ryantsai（短 SHA：`aca963f`）— **@ryantsai** 既是回報者也是修正者。（是的，資深系統工程師也會遇到「兩端同時壞掉」的網路妖精。）  
  * 相關文件更新：`docs/LINUX_PORT.md`、`scripts/package-linux.sh`、`src-tauri/src/main.rs`

## Internal（內部）

* **開發體驗：** 綁定 Vite 與 Tailwind 的來源掃描範圍，避免大型除錯診斷產物卡住 debug 啟動。 （短 SHA：`4bc6e16`）

* **輸入測試：** 強化 Quick Connect 欄位的輸入自動更正政策測試。 （短 SHA：`67ce515`）
* **在地化流程：** 更新在地化規範以處理新增/變更的 key。 （短 SHA：`c6d0801`）

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.111/kkterm-0.1.111-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.111/kkterm-0.1.111-windows-arm64-setup.exe)

## Highlights

* **Server Room floor plan & 2.5D view overhaul**: shared grid/facing/view angles, full-height sizing, and room objects in the views. (PRs **#522**, **#526**, **#527** by @ryantsai)  

* **Terminal reliability wins**: copy-on-select focus/clipboard fallbacks fixed, and terminal focus restored after multiline paste. (PRs **#529**, **#530** by @ryantsai; issue reports by **truedano**/**catyku**)  
* **RDP on older Windows**: add a legacy TLS fallback to reduce “TLS handshake failed” connection issues. (Issue **#344**, PR **#532** by @ryantsai; reporter **BossTsai**)

## New

* **IT Ops: Reworked Server Room View controls** and **full-height searchable object picker** for editing. (PR **#531** by @ryantsai)

## Improved

* **Server Room floor plan & 2.5D view**: window-filling grids, zoom levels, and panning for a better “fill the pane, not the void” experience. (PR **#526** by @ryantsai)

* **Room-view racks**: painted in their **shell finish** (instead of status colors) for a cleaner visual separation. (PR **#528** by @ryantsai)
* **Server Room floor plan & 2.5D view**: shared grid, facing, view angles, and room objects between the two spatial views. (PR **#522** by @ryantsai)

## Fixed

* **Server Room floor plan / 2.5D view**: taking the **full pane height**. (PR **#527** by @ryantsai)

* **[codex] Terminal copy-on-select clipboard fallback**. (PR **#529** by @ryantsai; reporter **truedano**)
* **Terminal focus restored** after the multiline paste confirmation closes. (PR **#530** by @ryantsai; reporter **catyku**)
* **[rdp] Legacy TLS fallback** via native-tls for old Windows hosts. (Issue **#344**, PR **#532** by @ryantsai; reporter **BossTsai**)

## Internal

* TypeScript/Vite configuration updates (PR/commit: `c12b67b`)

* Installer provider handling + installer button UI style updates (commit `842618d`)
* URL address bar security state indicators and styling updates (commit `0bee5a4`, `ffe2093` indirectly via context)
* URL credential management UI improvements + tests (commit `ada83dc`, `65a7a2e`)
* WebView certificate handling fixes + tests (commit `d4bd571`, `dbd0d9a`)
* Misc localization/document/tooling updates (commit `718f28f`)

---

## 亮點

* **機房平面圖與 2.5D 檢視大改版**：共享格狀配置/朝向/視角，並確保視圖能滿版高度，同時在檢視中顯示機房物件。（PR **#522**、**#526**、**#527**，作者 @ryantsai）

* **終端機可靠性提升**：修正複製選取（copy-on-select）相關的焦點/剪貼簿 fallback，以及多行貼上確認後的終端機焦點回復。（PR **#529**、**#530**，作者 @ryantsai；問題回報者 **truedano**/**catyku**）
* **舊版 Windows 的 RDP**：加入 legacy TLS fallback，降低遇到「TLS handshake failed」連線問題的機率。（Issue **#344**，PR **#532**，作者 @ryantsai；回報者 **BossTsai**）

## 新增

* **IT Ops：機房檢視控制項重做**，以及編輯用的**全高可搜尋物件選擇器**。（PR **#531**，作者 @ryantsai）

## 改善

* **機房平面圖與 2.5D 檢視**：格狀配置可填滿視窗、支援縮放等級與平移，讓體驗更像是「填滿 Pane，不是留下空洞」。（PR **#526**，作者 @ryantsai）

* **機房檢視的機櫃（racks）**：改以 **機櫃外殼（shell）質感**上色（取代狀態色），視覺更乾淨。（PR **#528**，作者 @ryantsai）
* **機房平面圖與 2.5D 檢視**：共享格狀配置、朝向與視角，並讓兩個空間檢視之間的機房物件一致。（PR **#522**，作者 @ryantsai）

## 修正

* **機房平面圖 / 2.5D 檢視**：能套用**完整的 Pane 高度**。（PR **#527**，作者 @ryantsai）

* **[codex] 終端機複製選取（copy-on-select）剪貼簿 fallback**。（PR **#529**，作者 @ryantsai；回報者 **truedano**）
* **多行貼上確認視窗關閉後回復焦點**。（PR **#530**，作者 @ryantsai；回報者 **catyku**）
* **[rdp] 舊版 Windows 的 native-tls legacy TLS fallback**。（Issue **#344**，PR **#532**，作者 @ryantsai；回報者 **BossTsai**）

## Internal

* TypeScript/Vite 設定更新（`c12b67b`）

* 安裝程式（installer）提供者處理與按鈕 UI 樣式更新（`842618d`）
* URL 位址列安全狀態指示與樣式更新（`0bee5a4`；另含背景提及 `ffe2093`）
* URL 憑證管理 UI 改善與測試（`ada83dc`、`65a7a2e`）
* WebView 憑證處理修正與測試（`d4bd571`、`dbd0d9a`）
* 雜項本地化/文件/工具更新（`718f28f`）

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.110/kkterm-0.1.110-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.110/kkterm-0.1.110-windows-arm64-setup.exe)

## Highlights

* New **2.5D Server Room View** with rack cabinet placement, next to Elevations and Floor plan—because your data center deserves a little perspective. 😄

* Improved Connection management in IT Ops: **rack-device click-to-connect** for bound Connections and a smoother Connection Tree search experience.
* Fixed AI and UI issues: the **Stop** button no longer leaves the Assistant work panel stuck “thinking”, and **PC Info** non-English values are readable again.

## New

* **2.5D Server Room View** with rack cabinet placement (PR #514).

* **Connection Tree**: added a **clear button** to the search box (PR #517).
* **Rack-device connect popover** with click-to-connect for bound Connections (PR #518).

## Improved

* **Open connection icon** foreground color picker adjusted to avoid clipping (PR #515).

* **macOS**: implemented per-WebView certificate bypass for URL Sessions and documented `ignoreCertificateErrors` behavior (PR #519).
* **ACP / AI**: improved handling for ACP bridge protocol issues and streamed CLI agent progress (PR #520).

## Fixed

* **AI Stop button** no longer leaves the work panel stuck thinking (PR #511).

* **PC Info widget**: corrected garbled non-English values (PR #512).
  
## Internal

* Added **KKTerm landing page** and a manual Cloudflare deploy workflow (PR #513).

---

## v0.1.110（繁體中文 / Taiwan）

## 重點

* 新增 **2.5D 機房視圖**，支援機櫃擺放（在 Elevations 與平面圖旁邊一起出現），讓你的資料中心多一點「空間感」。😄

* IT Ops 的 Connection 管理更順：**機櫃裝置點擊連線（click-to-connect）**（針對已綁定的 Connections），以及 Connection Tree 搜尋體驗改善。
* 修正 AI 與介面問題：**Stop** 按鈕不再讓助理的工作面板卡在「思考中」，以及 **PC Info** 的非英文內容不再變亂碼。

## 新增

* **2.5D 機房視圖**（含機櫃擺放）（PR #514）。

* **Connection Tree**：在搜尋框加入 **清除（clear）按鈕**（PR #517）。
* **機櫃裝置連線彈出視窗**：支援對已綁定的 Connections 進行點擊連線（PR #518）。

## 改善

* **連線圖示（Open connection icon）**：前景色選擇器調整位置，避免被裁切（PR #515）。

* **macOS**：針對 URL Sessions 實作每個 WebView 的憑證繞過，並補充 `ignoreCertificateErrors` 行為說明（PR #519）。
* **ACP / AI**：改善 ACP bridge 協定問題與 CLI 代理的串流進度顯示（PR #520）。

## 修正

* **AI Stop 按鈕**：不再讓工作面板卡在「思考中」（PR #511）。

* **PC Info 小工具**：修正非英文數值顯示為亂碼的問題（PR #512）。

## 內部

* 新增 **KKTerm landing page** 與手動 Cloudflare 部署工作流程（PR #513）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.109/kkterm-0.1.109-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.109/kkterm-0.1.109-windows-arm64-setup.exe)

## Highlights

* Improved **PC Info** Dashboard Widget Instance with more system details (manufacturer/model/family/SKU/serial/UUID, etc.) and updated localization keys.  

* Better large file viewing in the workspace: **FileViewer** now benefits from virtualized **LargeTextViewer** with status-bar progress (so your terminal-sized text blocks don’t feel as heavy).  
* Enhanced **IT Ops** rack workflows: rack depth options + validation, along with updated **RackDialog** UI and localization.

## New

* **Server Room** management and **Rack Item ↔ Connection** bindings:
  * Added Server Room creation/management in **ServerRoomDialog** and **SitesTab**
  * Introduced **RackItemBindingsDialog** to manage connections associated with Rack Items
  * Updated **RackStage** to support binding items to connections
  * Refactored **SiteDialog** to focus on Server Room management

## Improved

* **PC Info** Dashboard Widget Instance: added additional system information fields and localization updates (e.g., `dashboard.pcInfoField.pcModel`).

* Rack inventory UI: rack depth options (presets + custom input) and updated **RackDialog**.
* More robust rack/depth handling in IT Ops (including related UI/logic updates).

## Fixed

* Improved large text viewing in **FileViewer** by adding virtualized **LargeTextViewer** and status-bar progress (PR #510 by @ryantsai).  

## Internal

* Updated localization docs and translations for new/updated labels (including PC model and server room/rack depth related text).

* Refactored vendor string handling and updated related IT Ops tests.
* Removed audit/relationship metadata from **RackItemDialog** and related components, and updated affected tests.
* Removed `scope` option from recipes and updated installer tests for machine-scope entries.  

---

## 重要內容

* 改善 **PC Info** Dashboard Widget Instance，補上更多系統資訊（廠商/型號/系列/SKU/序號/UUID 等），並同步更新在地化字串。

* 工作區的大型檔案顯示體驗更好：**FileViewer** 已支援虛擬化的 **LargeTextViewer**，並在狀態列顯示進度（讓那種終端機等級的巨量文字不至於「卡到像網路斷線一樣」）。
* **IT Ops** 機櫃流程更完整：新增機櫃深度選項與驗證，並更新 **RackDialog** 介面與在地化。

## 新增

* **Server Room** 管理與 **Rack Item ↔ Connection** 綁定：
  * 在 **ServerRoomDialog** 與 **SitesTab** 新增/管理 Server Room
  * 新增 **RackItemBindingsDialog**，用來管理與 Rack Items 關聯的連線
  * 更新 **RackStage**，支援將項目綁定到連線
  * 重構 **SiteDialog**，改以 Server Room 管理為主

## 改善

* **PC Info** Dashboard Widget Instance：新增更多系統資訊欄位與在地化更新（例如 `dashboard.pcInfoField.pcModel`）。

* 機櫃盤點/建立介面：支援機櫃深度選項（預設 + 自訂輸入）與更新 **RackDialog**。
* IT Ops 的機櫃/深度處理更完善（包含相關 UI/流程更新）。

## 修正

* 改善 **FileViewer** 的大型文字檔顯示：加入虛擬化 **LargeTextViewer** 與狀態列進度（PR #510，作者 @ryantsai）。  

## Internal

* 更新在地化文件與多語系翻譯（包含 PC model、server room、機櫃深度等相關字串）。

* 重構供應商字串處理方式，並更新對應 IT Ops 測試。
* 從 **RackItemDialog** 與相關元件移除稽核/關聯中繼資料，並更新受影響測試。
* 移除配方（recipes）的 `scope` 選項，並更新安裝器機器範圍測試。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.108/kkterm-0.1.108-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.108/kkterm-0.1.108-windows-arm64-setup.exe)

## Highlights

* **Connection search now beats the “Show Connected” filter** (so you’ll actually find the connection you typed). 🫡  

* **Dashboard PC Info widget gets an animated refresh** and richer macOS/Linux details.  
* **Server Room View adds a top-down floor-plan layout** with health/utilization metrics.

## New

* **Server Room View:** Added a **top-down floor-plan** layout (tiles by rack, with legend and persisted metric choice).  
  * PR #506 (see also #506 in highlights below context)

## Improved

* **Dashboard (PC Info):** Updated to an **animated PC Info widget** with per-section transitions/graphics and macOS/Linux enrichment.

* **IT Ops dialogs:** Moved the **icon foreground palette into the selector popover** so it fits the recolor-capable icons flow better.  
  * PR #501

## Fixed

* **Connections:** **Search overrides the “Show Connected” filter**, surfacing matching connections by name even when the live-status toggle would otherwise hide them.  
  * PR #503

* **Dashboard:** **Fix URL widget webviews covering overlays** when Dashboard overlays are open.  
  * PR #502  
* **Dashboard (PC Info):** Show **all real GPUs** (discrete-first) and avoid hiding secondary cards.  
  * PR #508

## Internal

* Updated stale docs and usage counts across localized READMEs. PR #500  

* Rename IT Ops terminology from **“Fleet” to “Site”** globally (product-vocabulary + related i18n/docs/schema renames). PR #504  
* Installer catalog updates for additional app entries (including Blender / ComfyUI / LM Studio, plus other design/AI tools). PR #506–#509 PR list in generated notes.  
* Various localization/doc updates for UI consistency and terminology. (Includes PC Info i18n cleanup and i18n additions.)

---

## 0.1.108 亮點（Highlights）

* **連線搜尋現在會覆蓋「只顯示已連線（Show Connected）」篩選**（不然你打字找不到，就很像在終端機裡迷路）。🫡  

* **儀表板的 PC Info Widget 改版為動畫風格**，並增加 macOS/Linux 的資訊內容。  
* **機房（Server Room）檢視新增俯視平面圖**，可顯示健康度/使用率指標。

## 新增（New）

* **機房檢視（Server Room View）：** 新增 **俯視的平面圖（floor-plan）布局**（用磚塊呈現機櫃，並附圖例與指標選擇的保留設定）。  
  * PR #506

## 改善（Improved）

* **儀表板（Dashboard / PC Info）：** 將 **PC Info Widget 更新為動畫版本**，包含各分段的切換/圖形動效，並強化 macOS/Linux 的資料整理。

* **IT Ops 對話框：** 將 **圖示前景色（icon foreground）調色盤**移到「圖示選擇器（selector popover）」內，讓可重新上色的圖示流程更順。  
  * PR #501

## 修正（Fixed）

* **連線（Connections）：** **搜尋會優先於「只顯示已連線」**，即使切換已連線篩選，輸入的連線名稱仍會被找出。  
  * PR #503

* **儀表板（Dashboard）：** 修正 **URL Widget 的 WebView 會蓋住 Dashboard overlay** 的問題。  
  * PR #502  
* **儀表板（PC Info）：** 修正 GPU 顯示，**會顯示所有真實 GPU（Discrete-first）**，避免次要顯示卡被隱藏。  
  * PR #508

## 內部（Internal）

* 更新各語系 README 的舊文件與使用數據。PR #500  

* 將 IT Ops 用語全面從 **「Fleet」改為「Site」**（包含產品用語/i18n/文件與相關命名）。PR #504  
* 安裝程式（Installer）目錄新增/更新應用條目（包含 Blender / ComfyUI / LM Studio 等）。PR #506–#509（依 GitHub 自動彙整清單）。  
* 其他語系/文件更新以提升 UI 一致性與用語正確性（包含 PC Info 的 i18n 清理與新增）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.107/kkterm-0.1.107-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.107/kkterm-0.1.107-windows-arm64-setup.exe)

## Highlights

* **Beyond Compare-style folder compare** is now available, with a collapsible tree view and copy/delete actions between panes. ([#491](https://github.com/ryantsai/KKTerm/pull/491))

* **File compare got character-level diffs**, making it much easier to spot exactly which characters changed (and **fixes folder compare hangs on macOS**). ([#493](https://github.com/ryantsai/KKTerm/pull/493), [#495](https://github.com/ryantsai/KKTerm/pull/495))
* New **built-in “PC Info” Dashboard Widget Instance**: deep hardware details across all sections. ([#494](https://github.com/ryantsai/KKTerm/pull/494), [#498](https://github.com/ryantsai/KKTerm/pull/498), [#499](https://github.com/ryantsai/KKTerm/pull/499))
* **Differences/Same filters** now use collapsible “filtered lines” folds (so your diff doesn’t get lost in the weeds). ([#496](https://github.com/ryantsai/KKTerm/pull/496))

## New

* **Beyond Compare-style folder compare** (two-pane directory diff) opened from the folder compare workflow. ([#491](https://github.com/ryantsai/KKTerm/pull/491))

* **PC Info built-in Dashboard widget**. ([#494](https://github.com/ryantsai/KKTerm/pull/494))
* **IT Ops rack device metadata** expanded, including a new `kuaiguai` device type. ([#490](https://github.com/ryantsai/KKTerm/pull/490))
* [codex] **Complete rack inventory metadata**. ([#492](https://github.com/ryantsai/KKTerm/pull/492))

## Improved

* **Beyond Compare-style intra-line diff cleanup** (cleaner intra-line rendering for modified content). ([#495](https://github.com/ryantsai/KKTerm/pull/495))

* **“Filtered lines” folds** are now collapsible in Differences/Same modes. ([#496](https://github.com/ryantsai/KKTerm/pull/496))
* PC Info: **deep hardware detail across all sections**. ([#498](https://github.com/ryantsai/KKTerm/pull/498), [#499](https://github.com/ryantsai/KKTerm/pull/499))

## Fixed

* **Folder compare hang on macOS** during large tree comparisons is fixed. (Includes the character-level diff work.) ([#493](https://github.com/ryantsai/KKTerm/pull/493))

* **Cleaned Beyond Compare-style intra-line diff** output. (So the red/green blocks behave better.) ([#495](https://github.com/ryantsai/KKTerm/pull/495))

## Internal

* Keep file compare responsive for large files. ([#489](https://github.com/ryantsai/KKTerm/pull/489))

* docs(readme): update stale installer size to under 20 MB. ([#497](https://github.com/ryantsai/KKTerm/pull/497))
* feat(compare): **Beyond Compare-style folder compare** and compare enhancements. ([#491](https://github.com/ryantsai/KKTerm/pull/491), [#490](https://github.com/ryantsai/KKTerm/pull/490))
* feat: implement normalization and parsing for PC Info snapshot cache. (Includes tests.) (Commit: 89b13d3)
* Add translations for system information and UI labels. (Commit: 292338d)

---

## Highlights（重點）

* **Beyond Compare 風格的資料夾比較**已加入：支援可折疊樹狀檢視，並可在兩個 Pane 之間進行複製/刪除操作。([#491](https://github.com/ryantsai/KKTerm/pull/491))

* **檔案比較現在支援逐字元差異**，更容易看出究竟是哪些字元改了（同時**修正 macOS 上資料夾比較卡住**）。([#493](https://github.com/ryantsai/KKTerm/pull/493)、[#495](https://github.com/ryantsai/KKTerm/pull/495))
* 新增 **「PC Info」內建 Dashboard Widget Instance**：在所有區段提供更深的硬體資訊。([#494](https://github.com/ryantsai/KKTerm/pull/494)、[#498](https://github.com/ryantsai/KKTerm/pull/498)、[#499](https://github.com/ryantsai/KKTerm/pull/499))
* **Differences/Same** 篩選現在改用可折疊的「filtered lines」折疊區（避免 diff 被你我一起淹沒在細節裡）。([#496](https://github.com/ryantsai/KKTerm/pull/496))

## New（新增）

* **Beyond Compare 風格的資料夾比較**（雙 Pane 目錄差異）：從資料夾比較流程開啟。([#491](https://github.com/ryantsai/KKTerm/pull/491))

* **PC Info 內建 Dashboard widget**。([#494](https://github.com/ryantsai/KKTerm/pull/494))
* **IT Ops 機櫃裝置中繼資料**擴充，新增 `kuaiguai` 裝置類型。([#490](https://github.com/ryantsai/KKTerm/pull/490))
* [codex] **完成機櫃盤點（rack inventory）中繼資料**。([#492](https://github.com/ryantsai/KKTerm/pull/492))

## Improved（改善）

* **Beyond Compare 風格的行內差異**清理/優化（讓行內呈現更乾淨）。([#495](https://github.com/ryantsai/KKTerm/pull/495))

* Differences/Same 模式的 **「filtered lines」折疊**改為可折疊。([#496](https://github.com/ryantsai/KKTerm/pull/496))
* PC Info：在 **所有區段提供更深的硬體細節**。([#498](https://github.com/ryantsai/KKTerm/pull/498)、[#499](https://github.com/ryantsai/KKTerm/pull/499))

## Fixed（修正）

* **修正 macOS 上大型資料夾樹比較會卡住**的問題。（包含逐字元差異相關改動。）([#493](https://github.com/ryantsai/KKTerm/pull/493))

* **修正/清理 Beyond Compare 風格的行內差異**呈現。（讓紅綠區塊更符合預期。）([#495](https://github.com/ryantsai/KKTerm/pull/495))

## Internal（內部）

* 讓檔案比較在大型檔案時保持回應速度。([#489](https://github.com/ryantsai/KKTerm/pull/489))

* docs(readme): 更新過期的安裝包大小描述為「低於 20 MB」。([#497](https://github.com/ryantsai/KKTerm/pull/497))
* feat(compare)：Beyond Compare 風格資料夾比較與相關比較功能。([#491](https://github.com/ryantsai/KKTerm/pull/491)、[#490](https://github.com/ryantsai/KKTerm/pull/490))
* feat：實作 PC Info 快照快取的正規化與解析（含測試）。(提交：89b13d3)
* 系統資訊與 UI 標籤的翻譯更新。(提交：292338d)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.106/kkterm-0.1.106-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.106/kkterm-0.1.106-windows-arm64-setup.exe)

## Highlights

* **File Compare in File Explorer & SFTP browser**: select a left file, then compare to a second file (Text / Image / Hex).

* **Resizable Git Browser + Worktrees**: resize the diff UI, switch/pick worktrees, and run sync + branch actions.
* **AI: Ollama Cloud + Ollama local auth support**: add a new `ollama-cloud` provider, plus optional API key/custom headers for local Ollama behind proxies.
* **New Dashboard Widget**: **PC Info** (Speccy-style system inventory snapshot) with updated i18n.

## New

* **PC Info Dashboard Widget**: show OS/CPU/memory/motherboard/graphics/storage/network/audio in a tabbed **Dashboard Widget Instance**.
  * PR: <https://github.com/ryantsai/KKTerm/pull/481> (SHA: `2099cdf`)

* **File Compare** in File Explorer & SFTP browser (Text/Image/Hex).
  * PR: <https://github.com/ryantsai/KKTerm/pull/484> (SHA: `983ccff`)
* **Ollama Cloud provider (`ollama-cloud`)** for direct cloud access.
  * PR: <https://github.com/ryantsai/KKTerm/pull/480> (SHA: `bd72a13`)
* **Optional API key + custom headers for local Ollama provider**.
  * Reporter: catyku (Issue #479)
  * PR: <https://github.com/ryantsai/KKTerm/pull/483> (SHA: `461faf1`)

## Improved

* **Git Browser**: resizable window/panes, **Worktrees** sidebar actions, and sync + branch/reset actions.
  * PR: <https://github.com/ryantsai/KKTerm/pull/477> (SHA: `939635c`)

* **Compare viewer**: resizable diff window + word-wrap toggle to reduce the “giant horizontal scrollbar” pain.
  * PR: <https://github.com/ryantsai/KKTerm/pull/486> (SHA: `b3b9718`)
* **Connections UI**: when a parent Connection has only one child, the child collapses into the parent row (less redundant clutter).
  * PR: <https://github.com/ryantsai/KKTerm/pull/485> (SHA: `a0428ae`)
* **Design system sync**: import Apple-esque component set into Claude Design.
  * PR: <https://github.com/ryantsai/KKTerm/pull/476> (SHA: `7970c47`)
* **IT Ops icons & Fleet UI polish**: fleet nav resize lag improvements, connection icon pickers, and updated icons.
  * PR: <https://github.com/ryantsai/KKTerm/pull/482> (SHA: `358c3b5`)

## Fixed

* **SFTP context menu positioning**: clamp the file context menu so it opens above the status bar.
  * PR: <https://github.com/ryantsai/KKTerm/pull/487> (SHA: `eabe08b`)

* **MCP tool surface / ConPTY UB / i18n consistency cleanup**: align MCP tool catalog and fix ConPTY undefined behavior; plus i18n consistency cleanup.
  * PR: <https://github.com/ryantsai/KKTerm/pull/475> (SHA: `6b751d9`)
  * (If your network was “green LEDs only,” this release finally made the rest behave too—no promises, but less weirdness.)

## Internal

* *(No internal-only changes were provided in the supplied release context.)*

---

## Highlights（重點）

* **檔案比較（File Explorer 與 SFTP 瀏覽器）**：先選左邊檔案，再選右邊檔案比較（Text / Image / Hex）。

* **Git Browser 可調大小 + Worktrees**：調整 diff 介面大小、切換/管理 worktrees，並可進行 Sync + 分支操作。
* **AI：Ollama Cloud + 本機 Ollama 的授權支援**：新增 `ollama-cloud` provider，並讓本機 Ollama 可選填 API key / 自訂 headers（用在反向代理情境）。
* **新 Dashboard Widget**：**PC Info**（類 Speccy 的系統盤點快照），並更新 i18n。

## New（新增）

* **PC Info Dashboard Widget**：在 Dashboard Widget Instance 中以分頁方式呈現 OS/CPU/記憶體/主機板/顯示卡/儲存/網路/音訊。
  * PR: <https://github.com/ryantsai/KKTerm/pull/481> (SHA: `2099cdf`)

* **檔案比較**：File Explorer 與 SFTP 瀏覽器支援（Text/Image/Hex）。
  * PR: <https://github.com/ryantsai/KKTerm/pull/484> (SHA: `983ccff`)
* **Ollama Cloud provider (`ollama-cloud`)**：直接存取 Ollama Cloud。
  * PR: <https://github.com/ryantsai/KKTerm/pull/480> (SHA: `bd72a13`)
* **本機 Ollama：可選 API key + 自訂 headers**。
  * 回報者：catyku（Issue #479）
  * PR: <https://github.com/ryantsai/KKTerm/pull/483> (SHA: `461faf1`)

## Improved（改善）

* **Git Browser**：可調大小的視窗/分割區、**Worktrees** 側邊欄操作，以及 Sync + branch/reset 動作。
  * PR: <https://github.com/ryantsai/KKTerm/pull/477> (SHA: `939635c`)

* **Compare viewer**：diff 視窗可調整大小 + 支援 word-wrap，減少「超長橫向捲動條」的痛點。
  * PR: <https://github.com/ryantsai/KKTerm/pull/486> (SHA: `b3b9718`)
* **Connections 介面**：當父 Connection 只有一個子 Connection 時，子列會折疊到父列（減少重複資訊）。
  * PR: <https://github.com/ryantsai/KKTerm/pull/485> (SHA: `a0428ae`)
* **Design system 同步**：匯入類 Apple 的元件集合到 Claude Design。
  * PR: <https://github.com/ryantsai/KKTerm/pull/476> (SHA: `7970c47`)
* **IT Ops：圖示與 Fleet 介面微調**：改善 fleet nav 調整大小延遲、加入連線 icon 選擇器，以及更新圖示。
  * PR: <https://github.com/ryantsai/KKTerm/pull/482> (SHA: `358c3b5`)

## Fixed（修正）

* **SFTP 檔案情境選單定位**：讓檔案右鍵選單會開在狀態列之上。
  * PR: <https://github.com/ryantsai/KKTerm/pull/487> (SHA: `eabe08b`)

* **MCP 工具介面 / ConPTY 未定義行為 / i18n 一致性清理**：對齊 MCP 工具目錄並修正 ConPTY 未定義行為，同時做 i18n 一致性整理。
  * PR: <https://github.com/ryantsai/KKTerm/pull/475> (SHA: `6b751d9`)
  * （如果你之前網路狀態一直是「綠燈」，這版希望其它地方也別再鬧脾氣—至少更少怪事。）

## Internal（內部）

* *(提供的 release context 中未包含純內部變更。)*

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.105/kkterm-0.1.105-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.105/kkterm-0.1.105-windows-arm64-setup.exe)

## Highlights

* Fix **Proxy settings** layout/labels so the page doesn’t repeat “Proxy” three times like it’s trying to debug itself.

* Fix **Import browser bookmarks** so its **Tab** won’t get stuck on “Looking for browser bookmark sources…” forever.

## New

* Connection Import: add support for **HTTP/HTTPS ports** and improve the **port selection** UI. (PR #451)

## Improved

* (Dashboard) App launcher widget styling and icon rendering improvements for macOS. (PR #1705c2b, PR #b5ed7a8, PR #7d6a5cf)

## Fixed

* Settings: tidy **Proxy settings** layout and label. (PR #473, @ryantsai)

* Connections: stop **Import browser bookmarks** from hanging indefinitely. (PR #474, @ryantsai)

## Internal

* Localization work for admin-related Chocolatey messages across multiple languages. (6c2d445)  

* Import dialog/bookmark handling refactor (UI components). (7fcd826)
* Enhance file picker filters for platform-specific app selection. (0fb8c93)

---

## 重點摘要

* 修正 **Proxy 設定** 的版面/標籤，讓頁面不再像在自我除錯一樣重複顯示「Proxy」三次。

* 修正「**匯入瀏覽器書籤**」的 **Tab**，避免卡在「Looking for browser bookmark sources…」永遠不結束。

## 新增

* 連線匯入：支援 **HTTP/HTTPS 埠**，並強化**埠選擇**介面。(PR #451)

## 改進

* （Dashboard）macOS 的 App launcher 小工具樣式與圖示呈現最佳化。(PR #1705c2b、PR #b5ed7a8、PR #7d6a5cf)

## 修正

* 設定：整理 **Proxy 設定**版面與標籤。(PR #473，@ryantsai)

* 連線：修正「**匯入瀏覽器書籤**」可能無限卡住。(PR #474，@ryantsai)

## 內部

* 多語系更新：與 Chocolatey 管理員相關的訊息。(6c2d445)

* 匯入對話框/書籤處理流程重構（UI 元件）。(7fcd826)
* 強化平台專用應用選擇的檔案選取篩選。(0fb8c93)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.104/kkterm-0.1.104-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.104/kkterm-0.1.104-windows-arm64-setup.exe)

## Highlights

* **Global Proxy for the whole app**: choose **System / No Proxy / Manual (HTTP/HTTPS/SOCKS5)** in **Settings → General**. (PR #461)

* **Global SSH zlib compression default now persists**: your chosen default is saved and applied on reload. (PR #462)
* **RDP overlay keyboard focus fixed**: clicks/keyboard focus now properly route into the RDP ActiveX overlay instead of forcing extra “tab dancing.” (PR #471, fixes #460)

## New

* **Proxy moved to its own top-level Settings section**: **Settings → Proxy** with a dedicated Proxy UI. (PR #464)

* **Installer improvements: Sysinternals quick launcher** plus **Bun recipe** and a new **Package Managers** section. (PR #467, PR #468)

## Improved

* **Sysinternals quick launcher is now searchable** (GUI launch + CLI list). (PR #468)

* **Softened drop shadows** that previously bled on light backgrounds across shared UI surfaces. (PR #463)

## Fixed

* **RDP ActiveX overlay keyboard focus** when clicking the overlay (proper fix for #460 using a thread-local mouse hook). (PR #471)  

* **RDP overlay click now grabs keyboard focus** (initial focus handling update). (PR #465)
* **Installer: Sysinternals tools launch elevated**, and **“Open elevated PowerShell”** is used consistently. (PR #470)
* **Installer: Chocolatey operations now run elevated (UAC) and machine-wide** so installs/upgrades/uninstalls behave as expected. (PR #472)  
  * Issue reporter: **@sw2000s-Git** reported session keyboard/function trouble; PR **#471** addresses that (not Chocolatey), but credit is still noted here to keep our network/KB wiring straight. 😉
* **App Launcher: fixes explorer.exe launching on macOS**. (PR #469)

## Internal

* Global app proxy work and docs/UI updates (PR #461, #464)

* Persist global SSH zlib compression default with settings validation + test coverage (PR #462)
* Installer tooling & localization updates for Sysinternals/Bun/Package Managers (PR #467, #468, #470, #472)
* RDP focus-policy updates and related tests (PR #465, #471)
* UI styling/shadow token adjustments (PR #463)

---

## Highlights（重點）

* **全域 Proxy 控制應用程式整體網路流量**：在 **設定 → 一般** 選擇 **系統 / 不使用 Proxy / 手動（HTTP/HTTPS/SOCKS5）**。 (PR #461)

* **全域 SSH zlib 壓縮預設值會被保留**：你選的預設會被儲存並在重新載入後生效。 (PR #462)
* **已修正 RDP overlay 的鍵盤焦點**：點擊/鍵盤輸入會正確導入 RDP ActiveX overlay，不用再額外切換分頁才聽話。 (PR #471，修正 #460)

## New（新增）

* **Proxy 搬到獨立的頂層設定頁**：**設定 → Proxy**，提供專屬的 Proxy 介面。 (PR #464)

* **安裝程式改進**：新增 **Sysinternals 快速啟動器**，加入 **Bun recipe**，並新增 **Package Managers** 分類。 (PR #467, PR #468)

## Improved（改善）

* **Sysinternals 快速啟動器支援搜尋**（GUI 直接啟動 + CLI 清單）。 (PR #468)

* **弱化在淺色背景上會外溢的陰影**，改善多處共用 UI 表面。 (PR #463)

## Fixed（修正）

* **RDP ActiveX overlay 鍵盤焦點**：點擊 overlay 時會正確導入（#460 的正確修正，使用 thread-local 滑鼠 hook）。 (PR #471)

* **點擊 RDP overlay 時會抓到鍵盤焦點**（焦點處理的初步更新）。 (PR #465)
* **安裝程式：Sysinternals 工具改為以提升權限（elevated）啟動**，並一致使用 **「開啟提升權限的 PowerShell」**。 (PR #470)
* **安裝程式：Chocolatey 相關操作改為提升權限（UAC）且以整台機器範圍執行**，讓安裝/升級/解除安裝更符合預期。 (PR #472)
  * 問題回報者：**@sw2000s-Git** 回報「session 鍵盤/功能在切換其他程式後無效」；此為 **PR #471** 的修正。（這裡附上引用只是提醒我們不要把網路/鍵盤的接線弄錯。😉）
* **App Launcher：修正 macOS 上誤用 explorer.exe 啟動**。 (PR #469)

## Internal（內部）

* 全域 Proxy、文件與 UI 更新（PR #461、#464）

* 保留全域 SSH zlib 壓縮預設值：設定驗證與測試覆蓋（PR #462）
* 安裝程式工具與在地化更新：Sysinternals/Bun/Package Managers（PR #467、#468、#470、#472）
* RDP 焦點策略更新與相關測試（PR #465、#471）
* UI 陰影樣式/色 token 調整（PR #463）

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.103/kkterm-0.1.103-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.103/kkterm-0.1.103-windows-arm64-setup.exe)

## Highlights

* Connection-tree folder nodes now use the default folder glyph (less “mystery icon,” more “that’s a folder”).  

* Terminal display is better aligned when emoji appear (Unicode 11 cell widths).  
* Assistant code sends won’t steal your focus from the terminal—your Session stays ready.  

## New

* Enhance status popup message styling to support multi-line wrapping.

## Improved

* SSH Port Forwarding now warns when saved port forwards fail to start (instead of only logging a transient notice), including amber toolbar state and clearer dialog rows.

* SSH Port Forwarding rules are persisted more reliably: durable rules are saved even if there’s no active/healthy Session when you add them.
* Explain outdated GitHub Copilot CLI with actionable guidance instead of surfacing a raw serde error.
* Connection import dialog refactor and styling updates (including refreshed test coverage and i18n resources).

## Fixed

* Persist the global SSH zlib compression default so setting it to “off” actually takes effect; previously the backend dropped the unknown field on save and connections that inherit defaults always fell back to “fast”.

* Honor the resolved SSH compression setting on every SSH-backed channel, not just terminals: SFTP file browsing/transfers, tmux session management, batch IT-Ops runs, and SSH key installs no longer hard-code compression on.
* Fix emoji column misalignment in the terminal by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/455> (Fixes #454)  
  *Also reported by:* **JosephCLJ** (Issue #454, PR #455) — “[Windows] 圖形顯示問題”
* Restore terminal focus after assistant sends code by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/459>
* Fix SSH port forward rule persistence order by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/458>
* Use default folder glyph for connection-tree folders by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/453>
* Explain outdated Copilot CLI instead of raw serde error by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/457> (Fixes #456)  
  *Also reported by:* **mickeoL** (Issue #456, PR #457) — “Looks like there is some syntax issue in AI Assistant”

## Internal

* Add scrcpy tool for Android screen mirroring and control.

* Update/adjust import-dialog-related assets, CSS, locales, and associated tests.
* Update .gitignore to include brag-output and ensure proper newline.

---

## 亮點

* 連線樹（Connection-tree）資料夾節點改用預設資料夾圖示（少一點「這到底是什麼」）。  

* 終端機（Terminal）在出現 emoji 時的排版更準確（Unicode 11 的字元寬度）。  
* 助理（Assistant）送出程式碼後不再奪走終端機焦點——你的 Session 依然保持就緒。  

## 新增

* 強化狀態彈出視窗（status popup）樣式，支援多行自動換行。

## 改進

* SSH 連接埠轉送（SSH Port Forwarding）當「儲存的轉送規則無法啟動」時會明確提醒：包含工具列琥珀色狀態與對話框更清楚的列狀態。

* SSH 連接埠轉送規則持久化更可靠：即使當下沒有可用/健康的 Session 也會先確實保存「耐久（durable）規則」。
* 當 GitHub Copilot CLI 太舊導致 SDK 啟動失敗時，改為提供可操作的更新建議，而不是直接顯示原始 serde 錯誤。
* 連線匯入對話框（Connection import dialog）重構與樣式更新（包含更新測試與 i18n 資源）。

## 修正

* 修正終端機 emoji 欄位錯位（Unicode 11 字元寬度）by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/455（Fixes> #454）  
  *同時被回報：* **JosephCLJ**（Issue #454, PR #455）— “[Windows] 圖形顯示問題”

* 助理送出程式碼後恢復終端機焦點 by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/459>
* 修正 SSH 連接埠轉送規則持久化順序 by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/458>
* 連線樹資料夾改用預設資料夾圖示 by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/453>
* 以可操作方式說明過舊的 GitHub Copilot CLI（取代原始 serde 錯誤）by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/457（Fixes> #456）  
  *同時被回報：* **mickeoL**（Issue #456, PR #457）— “Looks like there is some syntax issue in AI Assistant”

## 內部

* 新增 scrcpy 工具，用於 Android 螢幕鏡像與控制。

* 更新/調整匯入對話框相關資源、CSS、語系檔與對應測試。
* 更新 .gitignore：加入 brag-output 並確保換行正確。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.102/kkterm-0.1.102-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.102/kkterm-0.1.102-windows-arm64-setup.exe)

## Highlights

* Improved SSH startup script behavior for Connections, including editor support, per-connection option, and more robust tmux handling (PR #451, PR #449; commits include `bc40ace`, `163927d`, `200db90`, `60a69d3`, `3eee2ae`, `3e63a63`).

* Updated russh with vendored IronRDP crypto patches (PR #452; commit `d4502c9`).

## Improved

* SSH startup script UI/UX: updated editor and SSH connection options layout and translations across multiple languages (PR #451; commits `60a69d3`, `3eee2ae`, `3e63a63`).

* SSH startup script fallback without tmux so Connections can still start in environments without tmux (PR #451; commit `bc40ace`).

## Fixed

* Resolved all ESLint warnings so the lint gate only flags new problems (PR #449; commit `ecbd0f5`).
  * Thanks to Claude Opus 4.8 (Co-Authored-By in commit `ecbd0f5`)!

## Internal

* Upgrade russh with vendored IronRDP crypto patches (PR #452; commit `d4502c9`, SHA `200db90`).

* Type/compatibility and UI layout updates related to the SSH startup script editor and options (PR #451; `60a69d3`, `3eee2ae`, `3e63a63`, `bc40ace`).
* Lint-only cleanup (PR #449; `ecbd0f5`).  

---

## Highlights（重點）

* 改善 SSH 啟動腳本在「Connection」層級的行為：支援編輯器（editor）、每個連線（per-connection）選項，以及更穩健的 tmux 處理（PR #451、PR #449；相關提交包含 `bc40ace`、`163927d`、`200db90`、`60a69d3`、`3eee2ae`、`3e63a63`）。

* 更新 russh，套用附帶 IronRDP 的加密修補程式（PR #452；提交 `d4502c9`）。

## Improved（改進）

* SSH 啟動腳本使用者體驗：更新編輯器與 SSH 連線選項的版面，並擴充多語系翻譯（PR #451；提交 `60a69d3`、`3eee2ae`、`3e63a63`）。

* SSH 啟動腳本在「沒有 tmux」的環境下也能正常回退啟動，避免只在有 tmux 才工作（PR #451；提交 `bc40ace`）。

## Fixed（修正）

* 修正所有 ESLint 警告，讓 lint gate 只會標記新的問題（PR #449；提交 `ecbd0f5`）。
  * 特別感謝 Claude Opus 4.8（在提交 `ecbd0f5` 的 Co-Authored-By 註記中）！

## Internal（內部）

* 升級 russh 並套用附帶 IronRDP 加密修補程式（PR #452；`d4502c9`、`200db90`）。

* 與 SSH 啟動腳本編輯器/選項相關的 UI 版面調整（PR #451；`60a69d3`、`3eee2ae`、`3e63a63`、`bc40ace`）。
* 只屬於 lint 清理的變更（PR #449；`ecbd0f5`）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.101/kkterm-0.1.101-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.101/kkterm-0.1.101-windows-arm64-setup.exe)

## Highlights

* **Git Browser overlay**: A full in-app Git Browser (commit graph + full git client) is now available from terminal pane toolbars and the File Explorer toolbar when you’re in a git repo.  

* **Serial connections (macOS + cross-platform)**: Detect serial ports and make the **Line** field an editable dropdown.

## New

* **Git Browser overlay** (commit graph + full git client) — opened from a **Terminal** pane toolbar or **File Explorer** toolbar when inside a git work tree. ([#428](https://github.com/ryantsai/KKTerm/pull/428), [#427](https://github.com/ryantsai/KKTerm/pull/427) for psmux refresh context: local terminals)

* **GLM-5.2** added as a curated **OpenCode** model. ([#443](https://github.com/ryantsai/KKTerm/pull/443))

## Improved

* **Serial connection “Line” field** is now an editable dropdown populated from detected serial ports (instead of a Windows-only default). ([#432](https://github.com/ryantsai/KKTerm/pull/432), reported by @tzchang in #429)

* **macOS serial Line dropdown arrow** is shown properly in WKWebView. ([#434](https://github.com/ryantsai/KKTerm/pull/434), reporter credit: @tzchang)

## Fixed

* **Activity rail opening now switches to the correct Connection parent workspace**, so your **Session** doesn’t get “lost” in the wrong workspace. ([#440](https://github.com/ryantsai/KKTerm/pull/440), [#441](https://github.com/ryantsai/KKTerm/pull/441), PRs by @ryantsai)

* **Connection tree follows the active workspace** when opening/activating from the rail. ([#441](https://github.com/ryantsai/KKTerm/pull/441))
* **CLI auth terminal** now uses a verbatim `cmd.exe` command line (avoids nvm `.cmd` shimming issues). ([#442](https://github.com/ryantsai/KKTerm/pull/442), [#442](https://github.com/ryantsai/KKTerm/pull/442) by @ryantsai)
* **Copilot CLI integration**: resolve Copilot CLI externally instead of bundling it. (Prevents “could not find copilot” in distributed builds.) ([#435](https://github.com/ryantsai/KKTerm/pull/435))
* **SSH**: prevent app crash from port-forward teardown (scrcpy). (Terminal networks shouldn’t faceplant on exit.) ([#439](https://github.com/ryantsai/KKTerm/pull/439))
* **Child connection docking + row highlight** fixes for the Connection tree/canvas docking behavior. ([#447](https://github.com/ryantsai/KKTerm/pull/447))
* **Preserve original Session + split panes** in child-connection panorama mode (#430). ([#446](https://github.com/ryantsai/KKTerm/pull/446))  
  * Reported by @JosephCLJ in #430; fixed via [#446](https://github.com/ryantsai/KKTerm/pull/446).
* **Docked URL Pane close button**: use the toolbar close button for docked URL **Panes** (avoid the misaligned second “X”). ([#448](https://github.com/ryantsai/KKTerm/pull/448), reporter credit: @JosephCLJ via #430)
* **File Explorer**: move Git icon into the **Pane toolbar**. ([#444](https://github.com/ryantsai/KKTerm/pull/444))
* **Git Browser**: drop phantom `"origin"` branch from remotes list. ([#445](https://github.com/ryantsai/KKTerm/pull/445))
* **Git Browser**: fix psmux environment refresh for local terminals. ([#427](https://github.com/ryantsai/KKTerm/pull/427))

## Internal

* Re-align quarantined test guards and update related assertions after refactors. (Commit: `8f2ab21`)

* Miscellaneous doc/localization cleanup and styling tweaks (no user-facing claims).

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.100/kkterm-0.1.100-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.100/kkterm-0.1.100-windows-arm64-setup.exe)

## Highlights

* **Session Status Bar notice no longer gets buried** behind dialog backdrops—your “up to date” / notice popups stay on top (fix in [#412](https://github.com/ryantsai/KKTerm/pull/412) by @ryantsai).
* **SSH connections with compression** now negotiate more like `ssh -XC`, with a **per-host toggle** (feat in [#414](https://github.com/ryantsai/KKTerm/pull/414) by @ryantsai).
* **SSH key passphrases supported** end-to-end in the connection flow (codex support in [#425](https://github.com/ryantsai/KKTerm/pull/425) by @ryantsai; reported by @catyku).
* **macOS universal build**: one macOS download for both **Intel + Apple Silicon** (release in [#413](https://github.com/ryantsai/KKTerm/pull/413) by @ryantsai).

## New

* **Per-host SSH compression toggle** for Connections (feat in [#414](https://github.com/ryantsai/KKTerm/pull/414) by @ryantsai).
* **SSH key passphrase support** for Connections (codex support in [#425](https://github.com/ryantsai/KKTerm/pull/425) by @ryantsai; issue reporter: @catyku).

## Improved

* **Localized SSH compression & IT Ops / settings strings** across **all 13 locales** (localize in [#421](https://github.com/ryantsai/KKTerm/pull/421) by @ryantsai).
* **Connection dialog text + URL option labels** refreshed via localization updates (feat in [#414](https://github.com/ryantsai/KKTerm/pull/414) and related work in [#421](https://github.com/ryantsai/KKTerm/pull/421) by @ryantsai).
* **README feature highlights refreshed** with per-section screenshot placeholders (docs in [#416](https://github.com/ryantsai/KKTerm/pull/416) by @ryantsai).

## Fixed

* **Windows local shell env now built from the registry** so local PowerShell/pwsh sessions pick up user-defined variables correctly (fix in [#424](https://github.com/ryantsai/KKTerm/pull/424) by @ryantsai; issue reporter: @JosephCLJ).
* **Status Bar transient popup stacking fixed** so it stays above dialog backdrops (fix in [#412](https://github.com/ryantsai/KKTerm/pull/412) by @ryantsai).

## Internal

* **macOS universal build guard**: clearer local build behavior when the `x86_64` Rust target isn’t installed (build guard in [#415](https://github.com/ryantsai/KKTerm/pull/415) by @ryantsai).
* **Release packaging updated for macOS universal distribution** (release in [#413](https://github.com/ryantsai/KKTerm/pull/413) by @ryantsai).

---

## 亮點

* **工作階段（Session）的狀態列（Status Bar）通知不再被對話框遮住**： 「已是最新」/通知彈出會維持在最上層（修復於 [#412](https://github.com/ryantsai/KKTerm/pull/412)，作者 @ryantsai）。
* **SSH 連線的壓縮（compression）協商**更貼近 `ssh -XC`，並提供**每台主機（per-host）切換**（功能於 [#414](https://github.com/ryantsai/KKTerm/pull/414)，作者 @ryantsai）。
* **支援 SSH 金鑰密碼（passphrase）**：連線流程中的輸入/處理完整到位（codex 於 [#425](https://github.com/ryantsai/KKTerm/pull/425)，作者 @ryantsai；問題回報者 @catyku）。
* **macOS 通用版（Universal）發佈**：同一個 macOS 下載同時適用 **Intel + Apple Silicon**（發佈於 [#413](https://github.com/ryantsai/KKTerm/pull/413)，作者 @ryantsai）。

## 新增

* **每台主機的 SSH 壓縮切換**（Connections）（功能於 [#414](https://github.com/ryantsai/KKTerm/pull/414)，作者 @ryantsai）。
* **支援 SSH 金鑰密碼**（Connections）（codex 於 [#425](https://github.com/ryantsai/KKTerm/pull/425)，作者 @ryantsai；問題回報者 @catyku）。

## 改進

* **SSH 壓縮與 IT Ops / 設定字串**已翻譯到**全部 13 個語系**（localize 於 [#421](https://github.com/ryantsai/KKTerm/pull/421)，作者 @ryantsai）。
* **連線對話框（Connection dialog）文字與 URL 選項標籤**透過在地化更新整理（與 [#414](https://github.com/ryantsai/KKTerm/pull/414) 及 [#421](https://github.com/ryantsai/KKTerm/pull/421) 的相關工作一起完成）。
* **README 功能亮點更新**並加入各章節的截圖佔位區（docs 於 [#416](https://github.com/ryantsai/KKTerm/pull/416)，作者 @ryantsai）。

## 修正

* **Windows 本機 shell 環境改由登錄檔（registry）建置**：讓本機 PowerShell/pwsh 會正確取得使用者自訂變數（修復於 [#424](https://github.com/ryantsai/KKTerm/pull/424)，作者 @ryantsai；問題回報者 @JosephCLJ）。
* **修正 Status Bar 彈出層級堆疊（stacking）**：確保不會被對話框底幕（dialog backdrops）蓋住（修復於 [#412](https://github.com/ryantsai/KKTerm/pull/412)，作者 @ryantsai）。

## Internal

* **macOS 通用版本機建置保護（guard）**：當 `x86_64` Rust target 尚未安裝時，建置行為會更清楚（build guard 於 [#415](https://github.com/ryantsai/KKTerm/pull/415)，作者 @ryantsai）。
* **macOS 通用版發佈封裝流程更新**（發佈於 [#413](https://github.com/ryantsai/KKTerm/pull/413)，作者 @ryantsai）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.99/kkterm-0.1.99-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.99/kkterm-0.1.99-windows-arm64-setup.exe)

## Highlights

* Refreshes the current **PATH** into **psmux** panes so newly created **Sessions** can see tools added after the **Connection** started (goodbye, mysterious “command not found” gremlins).

* Aligns the **psmux** toggle correctly for a cleaner **Tab/Panes** control layout.

## Fixed

* **psmux Session PATH refresh**: ensure new **Sessions** receive an up-to-date **PATH** via `new-session -e PATH=<value>`; also right-align the **psmux** toggle. Credits: @ryantsai in <https://github.com/ryantsai/KKTerm/pull/410>.  

* **Workspace edit dialog cleanup**: simplify the workspace icon section by removing the workspace name title and the “Icon” caption, leaving the icon edit button and color palette. Credits: @ryantsai in <https://github.com/ryantsai/KKTerm/pull/411>.
* **Windows local-shell environment**: local **PowerShell**/pwsh **Sessions** now see the same environment as a directly launched shell, including user-defined variables set via `setx` (e.g. `ANTHROPIC_BASE_URL`). KKTerm rebuilds the child environment from the registry with `CreateEnvironmentBlock` instead of forwarding only a curated allowlist of its own (possibly stale) process variables. Credits: @JosephCLJ in <https://github.com/ryantsai/KKTerm/issues/419>.

## Internal

* (No internal-only changes provided in the release context.)

---

## 亮點

* 會將目前的 **PATH** 重新灌入 **psmux** 的 **Pane**，讓在 **Connection** 啟動之後新增的工具，能被後續建立的 **Session** 正確使用（告別那種「明明裝了怎麼找不到指令」的小惡魔）。

* 修正 **psmux** 開關的對齊方式，讓 **Tab / Panes** 的控制區更整齊。

## 修正

* **psmux Session PATH 更新**：確保新的 **Session** 會透過 `new-session -e PATH=<value>` 拿到最新的 **PATH**；並同時將 **psmux** 開關右對齊。致謝：@ryantsai，<https://github.com/ryantsai/KKTerm/pull/410。>  

* **工作區編輯對話框整理**：精簡工作區圖示區塊，移除工作區名稱標題與「Icon」註記，只保留圖示編輯按鈕與顏色調色盤。致謝：@ryantsai，<https://github.com/ryantsai/KKTerm/pull/411。>
* **Windows 本機 Shell 環境變數**：本機 **PowerShell**/pwsh **Session** 現在會拿到與直接啟動 Shell 相同的環境，包含使用者透過 `setx` 設定的變數（例如 `ANTHROPIC_BASE_URL`）。KKTerm 改以 `CreateEnvironmentBlock` 從登錄檔重建子行程環境，不再只轉送自身（可能已過時）行程中一份固定的允許清單。致謝：@JosephCLJ，<https://github.com/ryantsai/KKTerm/issues/419。>

## Internal

* （此版釋出內容中未提供純內部變更。）

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.98/kkterm-0.1.98-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.98/kkterm-0.1.98-windows-arm64-setup.exe)

## KKTerm v0.1.98 Release Notes

### Highlights

* **IT Ops:** Enjoy *live* Batch Run output, a **Run Report** viewer for finished runs, and an **n8n-style Automation editor** (PR #408 by @ryantsai): more signal, fewer SSH “wait… it’s buffering… right?” moments.

* **PowerShell Sessions:** Add **psmux session management** for **local PowerShell / PowerShell 7** connections via an opt-in toggle (PR #409 by @ryantsai).

### New

* **IT Ops module upgrades (PR #408):**
  * Live per-host stdout/stderr streaming during Batch Runs, with automatic reveal as it runs.
  * Persist per-host output (capped) and open a read-only **Run Report viewer** from recent runs.
  * Keep streamed output visible on the live grid when a host times out.

* **Automation editor (PR #408):**
  * Replace the create dialog with an **n8n-style node editor** (draggable trigger → condition → action canvas), including ping/TCP triggers.
  * Add a **Test** action to sample the trigger once, report whether the condition would fire, and dry-run actions (no email/webhook and no Batch Run start).
* **psmux session management for local PowerShell (PR #409):**
  * New opt-in toggle: **Use psmux session management** for local **PowerShell / pwsh** connections.
  * Local shell launch uses `psmux new-session -A -s <id> -- <pwsh>` with fallback when `psmux` isn’t available.

### Improved

* **UI consistency work** across module headers/top bars and related components (e.g., shared compact module header).

* **Dashboard Widget Instance color customization (PRs leading to v0.1.98):**
  * Custom color picker for dashboard/connection settings with strict six-digit hex validation.
* **AI Assistant layout** improvements for more responsive behavior.

### Fixed

* **psmux session isolation & command errors (PR #409 includes related fix):**
  * Improved **psmux Session** isolation and reduced command error cases affecting local session behavior.

### Internal

* Documentation, localization, and UI styling refinements (including translations across many locales for IT Ops-related strings).

* Release workflow/tooling documentation updates (e.g., Linux build dependency mention).

---

## KKTerm v0.1.98 更新說明（繁體中文／台灣）

### Highlights

* **IT Ops：** 支援 **Batch Run 即時輸出**、可在結束後開啟 **Run Report** 瀏覽器，並提供 **n8n 風格 Automation 編輯器**（PR #408，@ryantsai）：資訊更到位，少點「等一下…是不是卡在緩衝區？」的網路線上折磨。

* **PowerShell Session：** 為 **本機 PowerShell / PowerShell 7 連線**加入 **psmux Session 管理**（可透過選項開啟）（PR #409，@ryantsai）。

### New

* **IT Ops 模組強化（PR #408）：**
  * Batch Run 執行期間，**逐主機**串流 stdout/stderr，即時自動揭露正在跑的內容。
  * 為每個主機的輸出做持久化（有上限），並可從最近的執行清單開啟唯讀 **Run Report**。
  * 當主機逾時時，保留直播網格上的串流輸出，不會直接空白掉。

* **Automation 編輯器（PR #408）：**
  * 用 **n8n 風格節點編輯器**取代原本的建立對話框（可拖曳的觸發 → 條件 → 動作畫布），支援 ping/TCP 觸發。
  * 提供 **Test**：抽樣一次觸發、回報條件是否會觸發，並在**不會送出 email/webhook、也不會啟動 Batch Run** 的前提下進行動作乾跑（dry-run）。
* **本機 PowerShell 的 psmux Session 管理（PR #409）：**
  * 新增選項切換：**Use psmux session management**（用在本機 **PowerShell / pwsh** 連線）。
  * 本機啟動會使用 `psmux new-session -A -s <id> -- <pwsh>`，若找不到 psmux 則會回退。

### Improved

* 針對模組標題 / 上方列等介面一致性調整（包含共享的精簡模組標題）。

* **Dashboard Widget Instance 自訂顏色（相關 PR 進入本版）：**
  * 提供自訂色彩選擇器，並在輸入驗證上要求嚴格的六位十六進位色碼格式。
* **AI 助理版面**調整為更符合響應式需求。

### Fixed

* **psmux Session 隔離與命令錯誤（PR #409 含相關修正）：**
  * 強化 **psmux Session** 的隔離，改善影響本機 Session 行為的部分命令錯誤情況。

### Internal

* 文件與在地化、以及 UI 樣式微調（包含 IT Ops 相關字串在多個語系的翻譯）。

* 發行流程／工具文件更新（例如在 Linux 建置流程中提到的套件依賴說明）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.97/kkterm-0.1.97-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.97/kkterm-0.1.97-windows-arm64-setup.exe)

## Highlights

* Smoother UI transitions across Connection and AI panels (less “jumpy” focus and panel motion—your Tab switching should feel less like herding mice in a dark terminal).

## New

* Connection/AI panel transitions: animation classes added for panel transitions. (`9e630b7`, `804c1d1`)

* Dialog styling updates: dialog backdrop and z-index adjusted to ensure proper stacking over the Activity Rail. (`3eb1364`)

## Improved

* Assistant Panel focus behavior: added `focusWithoutScrolling` to prevent unwanted scroll behavior. (`9e630b7`)

* Panel animations and layout management: improved panel animation + layout management for AI and connection panels. (`a3292ee`)
* App shell styles: removed min-width and disabled animation during panel transitions. (`b0d9986`)

## Fixed

* Installer handoff on Windows: updated and refactored the installer handoff command to improve process handling and cleanup logic. (`94be613`, `294ee13`)

## Internal

* Updated UI/behavior coverage with related tests (assistant panel focus + titlebar theme, dialog portal policy). (`9e630b7`, `3eb1364`, `b0d9986`)

* Merged changes from `main` (release content consolidation). (`52b2deb`, `513ddc5`)
* Documentation updates for installer/settings related areas. (`294ee13`)

---

## 亮點

* Connection 與 AI 面板的介面切換更順了（減少「焦點亂跳」與面板動作帶來的干擾——Tab 切換體感更像順暢的終端機，而不是在黑暗中抓老鼠）。

## 新增

* Connection/AI 面板切換動畫：加入面板過渡的動畫類別。 (`9e630b7`, `804c1d1`)

* 對話框樣式更新：更新對話框遮罩（backdrop）與 z-index，確保層級正確並覆蓋在 Activity Rail 之上。 (`3eb1364`)

## 改善

* Assistant 面板焦點行為：新增 `focusWithoutScrolling`，避免不必要的捲動。 (`9e630b7`)

* 面板動畫與版面管理：強化 AI 與連線（connection）面板的動畫與版面管理。 (`a3292ee`)
* App shell 樣式：移除 min-width，並在面板切換時停用動畫。 (`b0d9986`)

## 修正

* Windows 安裝程式交接（handoff）：更新並重構安裝程式交接指令，以改善程序處理與清理邏輯。 (`94be613`, `294ee13`)

## Internal

* 補強相關測試（Assistant 面板焦點、標題列主題、對話框 portal policy）。 (`9e630b7`, `3eb1364`, `b0d9986`)

* 合併 `main` 分支內容（針對發版彙整）。 (`52b2deb`, `513ddc5`)
* 文件更新（與安裝程式/設定相關）。 (`294ee13`)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.96/kkterm-0.1.96-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.96/kkterm-0.1.96-windows-arm64-setup.exe)

## Highlights

* **Theme preview grid**: pick your Connection/Tab/terminal colors from a live, tappable preview grid (no more “trust me bro” dropdown).

* **Folder power moves**: open *all* connections in a folder (as **Tabs** or split **Panes**), plus a **Close all connections** folder action.
* **Sync input to all terminals**: mirror keystrokes from the focused terminal Pane to every other open terminal Pane.

## New

* **Open all connections in a folder** (with Tabs or Panorama split-Panes options) — **#404** (reported by **Chien096**), thanks for the request! <https://github.com/ryantsai/KKTerm/pull/404>  

* **Close all connections** from a folder context menu — **#405** <https://github.com/ryantsai/KKTerm/pull/405>  
* **IT Ops Module (Host Groups, SSH Batch Runs & durable Automations, Phases 0–5)** — **#402** <https://github.com/ryantsai/KKTerm/pull/402>  
* **Cross-platform built-in MCP bridge + universal window screenshot tooling** — **#401** <https://github.com/ryantsai/KKTerm/pull/401>  

## Improved

* **Color scheme selection UI**: replace the color scheme dropdown with a live preview grid — **#407** <https://github.com/ryantsai/KKTerm/pull/407>  

* **Activity Rail management & visibility controls**: drag-to-reorder and improve layout/controls for Activity Rail items.
* **IT Ops Batch Runs — live output & Run Reports**: per-host output now **streams live** during a run (auto-revealed, no clicking needed), and finished runs save their full per-host output so the recent-runs list opens a reopenable **Run Report**.
* **IT Ops Automations — visual node editor**: create and edit Automations on an n8n-style draggable **trigger → condition → action** canvas with a per-node side panel and a **Test** button that samples the trigger and dry-runs the actions (nothing is actually sent).

## Fixed

* **Sync input fixes**: stop mouse garbling, move the sync-input toggle to the terminal Pane toolbar, and clamp native tooltip to the monitor work area — **#406** <https://github.com/ryantsai/KKTerm/pull/406>  

* **Connection status indicators** update in child Connection Tab rows.
* **Sync input behavior**: disable when closing terminal panes.

## Internal

* Roadmap doc sync + clarification for MCP platform support — **#400** <https://github.com/ryantsai/KKTerm/pull/400>

---

## 亮點

* **主題預覽網格**：在即時可點選的預覽網格中選擇配色（涵蓋 Connection / Tab / 終端機效果），不再只靠「下拉框你就信了吧」。

* **資料夾的強力操作**：可在資料夾中一次打開所有連線（選擇 **Tabs** 或拆成 **分割 Panes**），並新增 **資料夾「關閉所有連線」**動作。
* **同步輸入到所有終端機**：將聚焦的終端機 Pane 輸入內容，鏡像到所有已開啟的終端機 Panes。

## 新增

* **在資料夾中打開所有連線**（支援以 Tabs 或全局分割 Panes 呈現）— **#404**（由 **Chien096** 提出需求），感謝你！ <https://github.com/ryantsai/KKTerm/pull/404>  

* **資料夾情境選單：關閉所有連線** — **#405** <https://github.com/ryantsai/KKTerm/pull/405>  
* **IT Ops Module（Host Groups、SSH Batch Runs 與可持久 Automations，Phases 0–5）** — **#402** <https://github.com/ryantsai/KKTerm/pull/402>  
* **跨平台內建 MCP bridge + 通用視窗擷取工具** — **#401** <https://github.com/ryantsai/KKTerm/pull/401>  

## 改進

* **配色方案選擇介面**：將配色下拉選單改為「即時預覽網格」— **#407** <https://github.com/ryantsai/KKTerm/pull/407>  

* **Activity Rail 管理與可見性控制**：支援拖曳重新排序，並強化 Activity Rail 的佈局與控制項。

## 修正

* **同步輸入修正**：修正滑鼠造成的亂碼、將同步輸入切換移到終端機 Pane 工具列，並將原生提示（tooltip）限制在螢幕工作區內 — **#406** <https://github.com/ryantsai/KKTerm/pull/406>  

* **子 Connection 分頁（Child Connection Tab）**：更新連線狀態指示器顯示。
* **同步輸入行為**：在關閉終端機 Panes 時會停用同步輸入。

## Internal

* Roadmap 文件同步與 MCP 平台支援說明釐清 — **#400** <https://github.com/ryantsai/KKTerm/pull/400>

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.95/kkterm-0.1.95-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.95/kkterm-0.1.95-windows-arm64-setup.exe)

## Highlights

* Improved handling for update asset URLs and added checksum validation logic (so your updates behave a bit less like “mystery network traffic”).  

## Improved

* Refactored update asset URL handling and checksum validation logic.  

## Internal

* Updated update-related logic in `src-tauri/src/app_updates.rs` and refreshed documentation (`docs/ARCHITECTURE.md`, `docs/RELEASE.md`, `docs/manual/15-settings.md`).  
  * Commit: `c7f62c9` — “refactor: enhance update asset URL handling and checksum validation logic”  

---

## 精選重點

* 改善更新資產（update asset）URL 的處理方式，並新增檢查碼（checksum）驗證邏輯（讓更新別再那麼像「神秘網路流量」）。  

## 改善

* 重構更新資產 URL 的處理流程，並加入 checksum 驗證邏輯。  

## 內部

* 於 `src-tauri/src/app_updates.rs` 更新相關邏輯，並同步更新文件（`docs/ARCHITECTURE.md`、`docs/RELEASE.md`、`docs/manual/15-settings.md`）。  
  * 提交：`c7f62c9` — 「refactor: enhance update asset URL handling and checksum validation logic」

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.94/kkterm-0.1.94-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.94/kkterm-0.1.94-windows-arm64-setup.exe)

## KKTerm v0.1.94 Release Notes

### Highlights

* Improved SSH port forwarding UX in the Connection → Terminal flow: saved forwards now start on connect, and remote listener presentation/status notifications have been streamlined via the Status Bar. (No more “where did that message go?” moments.)

* More consistent dialog footer actions across platforms, so Pane-and-dialog button placement won’t play whack-a-mole with your muscle memory.

### New

* SSH forwarding: add **GatewayPorts forwarding reminder** for clarity during setup. (172046b, c0c2be6)

* SSH forwarding: **remote network address discovery for SSH connections**. (5299882)

### Improved

* SSH port forwarding dialog redesign:
  * Status Bar is the sole transient notification surface (info/success/warning/error tones).
  * Clearer visuals for saved mappings (including third-host target fans) and grouped non-loopback destinations by host. (c337534)

* Dialog footer actions are standardized across platforms using a shared `LegacyDialogActions` approach. (c648975, 7d7c018)
* Local listener discovery for SSH forwarding runs off the command thread. (ac38c29)
* SSH forwarding listener/status visuals updated (green listener status). (77f5027)

### Fixed

* SSH port forwarding: **start saved SSH forwards on connect**. (f90d41a)

* SSH port forwarding: **present and open SSH remote listeners correctly**. (0825c88)
* SSH port forwarding: **define SSH remote forward presentation rules**. (fffad7c)
* SSH remote gateway ports hint updated for clarity (Traditional Chinese update). (d3310c7)

### Internal

* macOS-specific handling for URL overlay visibility in the webview, including lifecycle test coverage. (172046b)

* Added/updated tests for dialog footer policy and SSH port forwarding behaviors. (c648975, 7d7c018, c337534, ac38c29, 0825c88, fffad7c)
* Internal refactors and merging activity included as part of this release. (8c32246)

---

## KKTerm v0.1.94 更新說明（繁體中文版／台灣）

### Highlights

* 在 Connection → Terminal 的 SSH 轉送流程中，體驗更完整：**已保存的轉送會在連線時自動啟動**，而且遠端監聽器的呈現與通知也改由 Status Bar 統一處理。（至少不會再發生「訊息跑哪去了？」的迷路時刻。）

* 各平台的對話框頁尾按鈕動作更一致：Pane 與對話框的按鈕擺放不再跟你的手感玩躲貓貓。

### New

* SSH 轉送：加入 **GatewayPorts 轉送提醒**，讓設定更清楚。（172046b, c0c2be6）

* SSH 轉送：**遠端網路位址（remote network address）探索**支援。（5299882）

### Improved

* SSH 轉送對話框重新整理：
  * Status Bar 成為唯一的短暫通知面板（info/success/warning/error），並套用對應語氣。
  * 已保存映射的視覺更清楚（包含第三方主機 target fans），並依主機群組化不同的非迴圈目的地。 (c337534)

* 各平台對話框頁尾動作已標準化：使用共用 `LegacyDialogActions` 做一致化。 (c648975, 7d7c018)
* SSH 轉送的本機監聽器探索不再佔用命令執行緒。 (ac38c29)
* SSH 轉送監聽器狀態視覺更新（綠色監聽狀態）。 (77f5027)

### Fixed

* SSH 轉送：**連線時啟動已保存的 SSH 轉送**。 (f90d41a)

* SSH 轉送：**正確呈現並開啟遠端 SSH listeners**。 (0825c88)
* SSH 轉送：**定義遠端轉送的呈現規則**。 (fffad7c)
* SSH 遠端 gateway ports 提示文字更新以提升清楚度（僅繁體中文內容更新）。 (d3310c7)

### Internal

* macOS：webview 的 URL overlay 可見性加入特定處理，並補上生命週期測試。 (172046b)

* 增修 dialog footer 政策與 SSH 轉送行為的測試。 (c648975, 7d7c018, c337534, ac38c29, 0825c88, fffad7c)
* 本版包含內部重構與合併活動。 (8c32246)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.93/kkterm-0.1.93-windows-arm64-setup.exe)

## Highlights

* Added an **increment_version** option to the Release workflow (default: **on**)—handy for release-engineering when you just want the notes, not the version bump.

* SSH Port Forwarding dialog improvements: editable dropdown inputs, enhanced suggestions, and updated tests—less “what port name was that again?” energy.

## New

* **Installer:** Improved installer helper with a **WSL distro manager**, added **Oh My Posh** to the Utilities section, and fixed **portable winget detection**. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/397>, also co-authored by @Claude Opus 4.8)

* **Release:** Added **increment_version** workflow_dispatch option (default on) to the Release workflow. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/399>)

## Improved

* **Workspace:** Full-width toolbar for docked **Document viewer** tabs/panes. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/398>, also co-authored by @Claude Opus 4.8)

* **Connections (SSH):** Enhanced editable dropdowns for SSH forwarding fields (common port names) and improved styling. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/397>)
* **Connections (SSH):** Implemented editable dropdown inputs for SSH forwarding fields, plus enhanced suggestions and tests. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/397>; PR merge activity includes implementation + tests)

## Fixed

* **Installer (portable tools):** Fixed portable winget detection so tools installed via portable winget are detected correctly (e.g., no more “not installed” after a successful install). (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/397>, also co-authored by @Claude Opus 4.8)

## Internal

* Updated release workflow configurations for Windows/macOS releases. (<https://github.com/ryantsai/KKTerm/compare/v0.1.92...v0.1.93>)

* Mirrored releases through **Cloudflare** (including worker + related scripts/tests/docs).  
* Fixed font handling on macOS, added **JetBrains Mono** as a fallback font and default on Linux.  
* Windows: enhanced PowerShell module path handling for documents folder.  
* Chore/docs: various release-mirror design and workflow-related documentation updates.

---

## Highlights（重點）

* 在 Release 工作流程新增 **increment_version** 選項（預設：**開啟**）—方便你在釋出時只想要「更新說明」，不想再多 bump 版本號（release-engineering 小確幸）。

* SSH Port Forwarding 對話框改進：可編輯下拉輸入、強化建議與更新測試—少一點「那個 port 名稱叫什麼來著？」的困擾。

## New（新增）

* **安裝器（Installer）：** 改善安裝助手：新增 **WSL 發行版管理員**、把 **Oh My Posh** 加到 Utilities，並修正 **portable winget 偵測**。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/397>, also co-authored by @Claude Opus 4.8)

* **Release：** Release 工作流程加入 **increment_version** 選項（預設開啟）。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/399>)

## Improved（改善）

* **Workspace：** 讓靠泊（docked）的 **文件檢視器（Document viewer）**工具列成為全寬顯示。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/398>, also co-authored by @Claude Opus 4.8)

* **連線（Connections）—SSH：** 強化 SSH forwarding 欄位的可編輯下拉（包含常見 port 名稱）並改進樣式。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/397>)
* **連線（Connections）—SSH：** 實作 SSH forwarding 欄位的可編輯下拉輸入，並強化建議與測試。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/397；合併過程包含實作與測試>)

## Fixed（修正）

* **安裝器（Installer）：** 修正 portable winget 偵測，確保可攜式 winget 安裝的工具能被正確辨識（避免成功安裝後仍顯示「not installed」）。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/397>, also co-authored by @Claude Opus 4.8)

## Internal（內部）

* 更新 Windows/macOS 釋出用的 release 工作流程設定。 (<https://github.com/ryantsai/KKTerm/compare/v0.1.92...v0.1.93>)

* 透過 **Cloudflare** 進行 Release mirror（包含 worker、相關腳本、測試與文件）。  
* 修正 macOS 字型處理，加入 **JetBrains Mono** 作為備援字型，並在 Linux 設為預設。  
* Windows：強化 PowerShell 模組路徑處理（documents 資料夾）。  
* 雜項：release-mirror 設計與工作流程相關文件更新。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.92/kkterm-0.1.92-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.92/kkterm-0.1.92-windows-arm64-setup.exe)

## Highlights

* Improved terminal font handling, including detection/normalization for monospace fonts and enhanced custom font support with refresh mechanisms (because cached glyphs are fun until they aren’t).

* Added font atlas refresh diagnostics for terminal renderers to help track terminal rendering font behavior (your sysadmin brain will thank you).

**Full Changelog**: <https://github.com/ryantsai/KKTerm/compare/v0.1.91...v0.1.92>

## New

* Font catalog enhancements: custom font support plus refresh mechanism.

## Improved

* Enhanced terminal font handling:
  * Monospace detection and font normalization.
  * Refresh mechanism for custom fonts and terminal rendering font family updates.

* Font atlas refresh mechanism and diagnostics for terminal renderers.

## Fixed

## Internal

* Documentation and tests added/updated for terminal font atlas refresh, font catalog, and custom font refresh behavior.

* Terminal/font refresh logic updates across terminal renderer and settings modules.

---

## 亮點（Highlights）

* 強化終端機字型處理：包含等寬字型的偵測/正規化，以及自訂字型的支援與更新機制（字型快取有時候很香，有時候就…不太行）。

* 為終端機渲染器加入字型圖集（font atlas）更新診斷，協助追蹤終端機字型行為（讓你的系統管理員腦袋少一點猜測）。

**完整變更紀錄**：<https://github.com/ryantsai/KKTerm/compare/v0.1.91...v0.1.92>

## 新增（New）

* 字型目錄（Font Catalog）強化：支援自訂字型，並加入更新機制。

## 改進（Improved）

* 強化終端機字型處理：
  * 等寬字型偵測與字型正規化。
  * 自訂字型與終端機字型族更新的更新機制。

* 終端機渲染器字型圖集更新機制與診斷。

## 修正（Fixed）

## 內部（Internal）

* 更新/新增文件與測試：涵蓋終端機字型圖集更新、自訂字型更新、與字型目錄行為等測試。

* 終端機渲染器與設定模組中的字型更新邏輯調整。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.91/kkterm-0.1.91-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.91/kkterm-0.1.91-windows-arm64-setup.exe)

## Highlights

* Refreshable **system font** list now appears in **App UI** and **Terminal** font pickers (so your dropdown doesn’t feel like a stale network route).

* Improved **credential unlock** flow for **Connection** management, with clearer related error handling.
* Status bar **notification/status popups** received updated progress styling and layout.

## New

* **System font refresh dropdown** for **App UI** and **Terminal fonts**.  
  * Options are organized as: **custom fonts** → **curated list** → **detected system fonts** (with deduping).

## Improved

* **Font picker wording & grouping clarity** (manual and translations updated).

* **System font refresh wording** clarified in the docs.
* **Status popup** progress styling/layout updated.
* **Notification duration behavior** adjusted as part of status bar work.

## Fixed

* **Prefer English system family names** for system fonts (backend behavior).

## Internal

* Replaced WebView-only system font access with a cross-platform Rust backend approach (`list_system_fonts`) and kept caching behavior in the frontend.

* Tests updated/refactored for status bar notice tones and popup behavior.
* Localization cleanup: removed deprecated font-related localization keys and refreshed translations.
* Docs updates related to system font refresh wording and settings font picker clarity.

---

## 0.1.91 亮點

* **系統字型**清單現在可在 **App UI** 與 **Terminal** 字型選單中「重新整理」——不會再像是網路路由一樣卡住不動。

* **Connection** 管理的 **憑證解鎖**流程得到強化，並改善相關錯誤處理。
* 狀態列的 **通知/狀態彈出視窗**更新了進度顯示樣式與版面。

## 新增

* **App UI** 與 **Terminal 字型**支援「系統字型重新整理」的下拉選單。  
  * 選項排序：**自訂字型** → **精選清單** → **偵測到的系統字型**（自動去除重複）。

## 改善

* **字型選擇器**的文字與分組更清楚（已更新手冊與翻譯）。

* 文件中已釐清 **系統字型重新整理**用語。
* 已更新 **狀態彈出視窗**的進度樣式/版面。
* 狀態列通知相關的 **通知時間行為**一併調整。

## 修正

* 系統字型偏好使用**英文 family name**（後端行為）。

## 內部

* 用跨平台 Rust 後端的方式取代 WebView-only 的系統字型存取（`list_system_fonts`），並維持前端快取行為。

* 更新/調整測試以反映狀態列通知音色與彈出行為變更。
* 本地化清理：移除已棄用的字型相關翻譯 key，並刷新翻譯內容。
* 文件更新：包含系統字型重新整理用語與設定頁「字型選擇器清晰度」相關內容。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.90/kkterm-0.1.90-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.90/kkterm-0.1.90-windows-arm64-setup.exe)

## Highlights

* Dock onto all Connection tabs (no more “where did that Pane go?” surprises).

## New

* Enhanced **New Workspace** dialog: added selection buttons for importing connections.

* Document viewer **soft wrap** with persisted state in the Session storage.
* Terminal settings: support for **custom shell profiles** (add/edit/remove) with fallback to platform defaults when deleted.

## Improved

* Terminal settings custom shell presets: improved validation for local shell command lines.

* Updated localization content for custom shell settings across multiple languages.

## Fixed

## Internal

* Updated asset protocol scopes for user-writable media.

* Removed outdated localization files and refreshed translations for custom shell settings.

---

## 亮點

* 可以停靠到所有「Connection」分頁（不用再遇到「這個 Pane 到哪去了？」的驚嚇）。

## 新增

* 強化 **新增工作區（New Workspace）**：加入匯入連線的選擇按鈕。

* 文件檢視器 **文字自動換行（soft wrap）**，並將狀態存到 Session storage。
* 終端機設定新增 **自訂 Shell 方案（custom shell profiles）**：支援新增/編輯/移除；刪除後會回退到平台預設值。

## 改善

* 終端機設定的自訂 shell presets：加強本機 shell 指令列的驗證。

* 多語系更新：針對自訂 shell 設定的在地化內容同步更新。

## 修正

## Internal

* 更新資產（asset）協定的權限範圍：針對使用者可寫入的媒體。

* 移除過期的在地化檔案，並刷新自訂 shell 設定相關翻譯。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.89/kkterm-0.1.89-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.89/kkterm-0.1.89-windows-arm64-setup.exe)

## Highlights

* Prevent an **AI widget** crash caused by `localStorage` access in sandboxed **Tabs**/**Panes** (your terminal won’t faceplant just because a widget wanted to remember something).

* Improve **file viewer** usability by adding **log parser selection**, so log formats can be matched more accurately when viewing in a **Session**.

## New

* Add **log parser selection** to the **file viewer**. ([#394](https://github.com/ryantsai/KKTerm/pull/394), [#392](https://github.com/ryantsai/KKTerm/pull/392), [#393](https://github.com/ryantsai/KKTerm/pull/393) via bundled work on the same release)

## Improved

* Stop truncating large custom UI fonts to ~**1 MB**, so large fonts (including CJK) display correctly instead of falling back. ([#392](https://github.com/ryantsai/KKTerm/pull/392))

* Document **MCP** and **AI assistant** behavior changes to set clearer expectations for **Dashboard Widget Instance** behavior. ([#393](https://github.com/ryantsai/KKTerm/pull/393))

## Fixed

* Fix **SecurityError** crash when **AI widgets** touch `localStorage`. ([#391](https://github.com/ryantsai/KKTerm/pull/391))

* Fix (fonts): stop truncating large custom UI fonts to ~**1 MB**. (Referenced in **Improved**; PR [#392](https://github.com/ryantsai/KKTerm/pull/392))

## Internal

* Update asset protocol configuration for font file access and add related test. (`1efaf1d`)

* Update dashboard catalog dialog styles and add related test. (`c7002f0`)
* Refactor context usage styles for compact design and update tests for new layout. (`5f46fb5`)
* Update log row layout to use content-sized columns in file viewer and add related test. (`0e28885`)
* Update Chinese localization for context usage terminology. (`163766d`)
* Remove deprecated localization files and update translations for parser types and viewer options. (`e97225f`)
* Merge PRs: #392 (`0940c12`), #393 (`dc2ab6a`), #394 (`20d2471`), plus associated commits in this release.

---

## 特色亮點

* 修正 **AI Widget** 在嘗試存取 `localStorage` 時造成的崩潰問題（讓你的終端機不要因為 Widget 想「順便記一下狀態」就當機）。

* 提升**檔案檢視器**的使用體驗：加入 **Log Parser 選擇**，讓你在**連線/Session**中查看不同格式的 log 時更貼近正確解析。

## 新功能

* 為**檔案檢視器**加入 **Log Parser 選擇**。([#394](https://github.com/ryantsai/KKTerm/pull/394), [#392](https://github.com/ryantsai/KKTerm/pull/392), [#393](https://github.com/ryantsai/KKTerm/pull/393) 於本版整合的相關工作)

## 改善

* 停止將大型自訂 UI 字型截斷到約 **1 MB**，讓大型字型（包含 CJK）能正常顯示，而不再回退到系統字型。([#392](https://github.com/ryantsai/KKTerm/pull/392))

* 文件化 **MCP** 與 **AI assistant** 的行為變更，讓你對 **Dashboard Widget Instance** 的行為有更清楚的預期。([#393](https://github.com/ryantsai/KKTerm/pull/393))

## 修正

* 修正 **AI widgets** 觸及 `localStorage` 時的 **SecurityError** 崩潰。([#391](https://github.com/ryantsai/KKTerm/pull/391))

* 修正（字型）：停止將大型自訂 UI 字型截斷到約 **1 MB**。（已在**改善**中列出；PR [#392](https://github.com/ryantsai/KKTerm/pull/392)）

## Internal

* 更新資產協定設定以支援字型檔案存取，並新增相關測試。(`1efaf1d`)

* 更新 Dashboard catalog 對話框樣式並新增相關測試。(`c7002f0`)
* 針對精簡設計重構 context usage 樣式，並更新測試以符合新佈局。(`5f46fb5`)
* 更新檔案檢視器的 log 列佈局，改用內容大小欄位，並新增相關測試。(`0e28885`)
* 更新中文本地化：context usage 用詞術語。(`163766d`)
* 移除已淘汰的本地化檔案，並更新 parser 類型與檢視器選項相關翻譯。(`e97225f`)
* 合併 PR：#392（`0940c12`）、#393（`dc2ab6a`）、#394（`20d2471`），以及本版中的相關提交。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.88/kkterm-0.1.88-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.88/kkterm-0.1.88-windows-arm64-setup.exe)

## Highlights

* Smarter AI context handling: context budgeting for AI providers and a compact conversation history, gated by usage.
* Better tab control: add close buttons and live status to File Explorer, SFTP, and Document tabs.
* More reliable terminal fonts: powerline/Nerd Fonts work without a system install (no extra “font pastor” required).

## New

* Assistant panel: show assistant context usage meter.

## Improved

* AI: implement context budgeting for AI providers and compact conversation history (usage-gated).
* File viewing: allow opening unsupported file types in external editors (as text, binary, or via the OS default app) instead of only using the inline viewer.
* Update experience: app update downloads now show real-time byte progress, with a cancel option and progress bar in the Status Bar.
* File Explorer / SFTP / Document tabs: surface a top-right close button when per-Tab close is hidden, and mirror the URL/WebView pane behavior.
* Document status: document connection dot turns green while the file is open (and “Close Connection” appears for open Documents).
* Terminal settings UX: suggest loaded custom fonts and provide an “open fonts folder” button; the terminal glyph atlas is rebuilt after fonts settle.

## Fixed

* Terminal: powerline/Nerd Fonts now render without needing a system-wide font install (Issue #349).

## Internal

* IT Ops documentation: design the IT Ops Module (ADR-0011 + ITOPS.md) and add target CONTEXT.md vocabulary for Phase 3.
* AI providers: document/implement gating for context compaction by usage.
* Docs and release-engineering updates for app update progress popup design.
* App update process: cancellable download flow with progress indication (status bar wiring).
* Font loading: load custom fonts via asset protocol, off the UI thread.

---

## 版本亮點（Highlights）

* 更聰明的 AI 內容處理：針對 AI 供應商的 context budgeting，以及更精簡的對話歷史（並依使用量做門檻控制）。
* 分頁操作更完善：為檔案瀏覽器（File Explorer）、SFTP 與文件（Document）分頁加入關閉按鈕與即時狀態。
* 終端機字型更可靠：powerline/Nerd Fonts 不再需要系統安裝（不用再做「字型牧師」那種事）。

## 新功能（New）

* 助理面板（Assistant panel）：顯示助理 context 使用量計量器（context usage meter）。

## 改進（Improved）

* AI：為 AI 供應商實作 context budgeting，並提供精簡對話歷史（依使用量門檻控制）。
* 檔案檢視：不支援的檔案類型可改用外部編輯器開啟（可選文字 / 二進位 / 或使用作業系統預設應用），不再只能使用 KKTerm 內建檢視器。
* 更新體驗：程式更新下載支援即時位元組（byte）進度顯示，並在狀態列（Status Bar）提供取消選項與進度條。
* File Explorer / SFTP / Document 分頁：當分頁上的每個關閉按鈕被隱藏（hideTopTabButtons）時，改在右上角顯示關閉按鈕，行為對齊 URL/WebView pane。
* 文件狀態（Document status）：文件在開啟期間連線點（connection dot）會變綠，並讓「Close Connection」在開啟的文件上也出現。
* 終端機設定體驗：提供已載入字型的建議清單、以及「open fonts folder」按鈕；字型穩定後會重建 glyph atlas。

## 修正（Fixed）

* 終端機字型：修正 powerline/Nerd Fonts 無需系統級安裝也能正常渲染（Issue #349）。

## 內部（Internal）

* IT Ops 文件：設計 IT Ops Module（ADR-0011 + ITOPS.md），並加入 Phase 3 的 CONTEXT.md 詞彙目標。
* AI 供應商：依使用量門檻控制 context compaction 的文件與實作。
* 文件與釋出工程：補上 app update progress popup 的設計文件。
* 程式更新流程：支援可取消的下載與進度顯示（Status Bar 相關串接）。
* 字型載入：透過 asset protocol 載入自訂字型，並放到 UI 執行緒之外。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.87/kkterm-0.1.87-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.87/kkterm-0.1.87-windows-arm64-setup.exe)

## KKTerm v0.1.87 Release Notes

### Highlights

* Document Connections (fileView) now have a **global Status Bar** status (kind, size, per-mode facts, encoding, editable badge), so you don’t have to hunt for the right footer like it’s a lost SSH key.

* More consistent handling when splitting panes—dragging/splitting a Document should no longer accidentally show an SFTP browser.

### New

* **Credential secret store management**:
  * Manage encrypted credential store status and **lock/unlock** behavior (including an unlock dialog).

* **Document viewer upgrades** (fileView):
  * Unknown file types open in the **editable Text/Code editor**; only recognized binary containers (zip/gzip/sqlite) fall back to **read-only Hex** (still accessible from the mode switcher).
  * Add a **Font & Encoding** hamburger menu on text-based modes.
  * Text mode encoding loads via **encoding_rs + chardetng** (Auto-detect default); saving stays **UTF-8** so non-UTF-8 loads are read-only.
  * Per-Connection **font family/size and encoding** persist in localStorage and restore when reopening.

### Improved

* Document viewer status moved from per-Document footer into the app **global Status Bar** via a documentStatusSlot (single status surface).

* Embedded pane dispatch is guarded more exhaustively so future Pane kinds don’t silently render the wrong surface.

### Fixed

* **[#386](https://github.com/ryantsai/KKTerm/pull/386)**: Fix dragging a Document onto another Pane to split by spawning an **SFTP browser**—EmbeddedConnectionPane now dispatches **fileViewer** for document splits.  
  Credit: @ryantsai (PR #386) and the co-author noted in the change (Claude Opus 4.8).

* i18n: Traditional Chinese translation updates related to encrypted secret store and file viewer UI expectations.

### Internal

* Localization: remove obsolete credential store localization files and update translations.

* File viewer CSS/display assertions added/updated in tests (file explorer + viewer behavior).

---

## KKTerm v0.1.87 更新說明（繁體中文（台灣））

### Highlights

* 文件連線（fileView）現在會把狀態集中到**全域 Status Bar**：包含 kind、size、各模式資訊、encoding、是否可編輯提示——不必再到處找文件底部 footer，就像找不到 SSH key 一樣。

* 分割 Pane 時的行為更一致：拖曳/分割文件時，不該再意外跳出 SFTP 瀏覽器。

### New

* **憑證加密 secret store 管理**：
  * 管理加密憑證儲存的狀態，以及**鎖定/解鎖**行為（包含解鎖對話框）。

* **文件檢視器升級**（fileView）：
  * 未知檔案類型改用**可編輯 Text/Code 編輯器**開啟；只有辨識為二進位容器（zip/gzip/sqlite）才會退回**唯讀 Hex**（仍可從模式切換器切回）。
  * 在文字模式加入**字型與編碼 Font & Encoding**「漢堡選單」。
  * 編碼載入使用 **encoding_rs + chardetng**（預設 Auto-detect）；儲存一律保持 **UTF-8**，因此載入非 UTF-8 內容會以**唯讀**方式避免靜默轉碼。
  * 每個 Connection 的**字型家族/大小與編碼**會存到 localStorage，重新開啟時會自動還原。

### Improved

* 文件狀態從每個文件的 footer 移到 app 的**全域 Status Bar**（透過 documentStatusSlot），變成單一狀態介面。

* Embedded pane 分派保護更完整，避免未來 Pane kind 造成「靜默渲染到錯的畫面」。

### Fixed

* **[#386](https://github.com/ryantsai/KKTerm/pull/386)**：修正將文件拖到其他 Pane 以進行分割時，會**錯誤產生 SFTP 瀏覽器**的問題——EmbeddedConnectionPane 現在分割文件會正確派發 **fileViewer**。  
  致謝：@ryantsai（PR #386）以及該變更中註明的共同作者（Claude Opus 4.8）。

* i18n：更新與加密 secret store 及文件檢視器 UI 相關的繁體中文翻譯。

### Internal

* Localization：移除過時的憑證儲存本地化檔並更新翻譯。

* 測試：加入/更新檔案總管與檢視器行為相關的 CSS/顯示斷言。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.86/kkterm-0.1.86-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.86/kkterm-0.1.86-windows-arm64-setup.exe)

## Highlights

* Create `Connections` faster: drop files/folders onto the **Connection Tree** to create the right **Session** types automatically (Document / File Explorer).

* Dashboard data portability: **widget export/import** and **selective database export/import** for backups you can actually move around.

## New

* **Connections:** Create Connections by dropping OS files/folders onto the **Connection Tree** (files → Document Connection, folders → File Explorer Connection), with drag highlighting and multi-drop. (#382, @ryantsai in <https://github.com/ryantsai/KKTerm/pull/385> — also references the earlier #382 work)

* **Dashboard:** Widget export/import (`.kkwidget` JSON) and selective database export/import (`.kkbackup`).  
  (#378 reported by @Androwei; PR <https://github.com/ryantsai/KKTerm/pull/381>)

## Improved

* **Document viewer:** Redesign with a unified toolbar and a status footer. (<https://github.com/ryantsai/KKTerm/pull/384>)

* **Installer Helper:** House-style redesign of the Installer Helper page, plus folding its footer status into the global status bar. (<https://github.com/ryantsai/KKTerm/pull/373>, <https://github.com/ryantsai/KKTerm/pull/380>)
* **Document/File viewer:** Introduced a redesigned universal file viewer analysis and supporting UI/docs updates. (<https://github.com/ryantsai/KKTerm/pull/374>)
* **Docs:** Fix stale references across README, ROADMAP, CONTRIBUTING, ADRs, and manual. (<https://github.com/ryantsai/KKTerm/pull/379>)

## Fixed

* **Installer Helper footer:** Folded the Installer Helper footer into the global status bar to avoid duplicate status lines. (<https://github.com/ryantsai/KKTerm/pull/380>)

* **i18n:** Corrected traditional Chinese translations for error messages. (sha `d0845ae`)

## Internal

* Added tests/guardrails around new behaviors (including Install Helper localization coverage and local files connection drop).

* Various docs/localization maintenance and cleanup of obsolete localization files.

---

## Highlights（重點）

* 更快建立 `Connections`：把檔案/資料夾拖放到 **Connection Tree**，系統會自動建立符合的 **Session** 類型（文件 / 檔案總管）。

* Dashboard 資料可攜性：**Widget 匯出/匯入**與**選擇性資料庫匯出/匯入**，讓備份更好搬家。

## New（新增）

* **Connections：** 透過把作業系統的檔案/資料夾拖放到 **Connection Tree** 來建立 Connections（檔案 → 文件連線、資料夾 → 檔案總管連線），支援拖曳高亮與一次丟多個。 (#382, @ryantsai in <https://github.com/ryantsai/KKTerm/pull/385> — 也延續先前 #382 的工作)

* **Dashboard：** Widget 匯出/匯入（`.kkwidget` JSON）與選擇性資料庫匯出/匯入（`.kkbackup`）。  
  （#378 由 @Androwei 提出；PR <https://github.com/ryantsai/KKTerm/pull/381）>

## Improved（改進）

* **文件檢視器：** 統一工具列 + 狀態頁尾重新設計。 (<https://github.com/ryantsai/KKTerm/pull/384>)

* **Installer Helper：** Installer Helper 版面 house-style 重新設計，並把其頁尾狀態折疊到全域狀態列。 (<https://github.com/ryantsai/KKTerm/pull/373>, <https://github.com/ryantsai/KKTerm/pull/380>)
* **文件/檔案檢視：** 通用檔案檢視器（含輕量編輯）分析的重新整理與配套 UI/文件更新。 (<https://github.com/ryantsai/KKTerm/pull/374>)
* **文件：** 修正 README、ROADMAP、CONTRIBUTING、ADRs 與手冊中的過期引用。 (<https://github.com/ryantsai/KKTerm/pull/379>)

## Fixed（修正）

* **Installer Helper 頁尾：** 把 Installer Helper 頁尾狀態整合到全域狀態列，避免重複的狀態列顯示。 (<https://github.com/ryantsai/KKTerm/pull/380>)

* **i18n：** 修正錯誤訊息的繁體中文翻譯。 (sha `d0845ae`)

## Internal（內部）

* 新行為的測試與防呆機制（例如 Install Helper 翻譯完整性測試、以及本機檔案拖放建立 Connections 的測試）。

* 各種文件/在地化維護與清理既有的過期在地化檔。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.85/kkterm-0.1.85-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.85/kkterm-0.1.85-windows-arm64-setup.exe)

## Highlights

* **Status bar polish:** Anchor the assistant working spinner to the right of the status bar (no more center-screen “mystery spinner”).

* **URL Connection reliability:** Stop native WebView status notice popups from being clipped behind the embedded browser.
* **SFTP Pane controls:** Add **per-pane view-options** (zoom + content-view background) for each file pane in an SFTP/FTP Connection.

## New

* **Dashboard:** **Export & import AI widgets** — export a single custom widget, **Export All**, or **Import** portable `.kkwidget` files from the Add Widget popup. Import is additive and never overwrites existing widgets. ([#378](https://github.com/ryantsai/KKTerm/issues/378))

* **Settings (Data):** **Selective export/import** — choose which categories (Connections, Workspaces, Dashboards & Widgets, Settings, MCP servers) to put in a `.kkbackup` file, with per-category **Skip / Add / Replace** on import. Sharing Connections **excludes passwords by default**; opt-in passwords are passphrase-encrypted. ([#378](https://github.com/ryantsai/KKTerm/issues/378))
* **SFTP:** Per-pane view-options menu (item zoom + content-view background) for Dashboard Widget Instance-style pane UX—each pane can look different and keeps its own settings. ([#372](https://github.com/ryantsai/KKTerm/pull/372) — by @ryantsai)
* **Installer:** Add **Git for Windows** to the **Development** section. ([#365](https://github.com/ryantsai/KKTerm/pull/365) — by @ryantsai)
* **Installer:** Make BentoPDF’s **NSSM service helper** installed **on-demand**. ([#366](https://github.com/ryantsai/KKTerm/pull/366) — by @ryantsai)

## Improved

* **Dashboard AI Widgets:** More deterministic widget creation via a deterministic source normalizer + placeholder guard. ([#363](https://github.com/ryantsai/KKTerm/pull/363) — by @ryantsai)

* **Connection (Terminal):** Persist the terminal toolbar font size across launches. ([#367](https://github.com/ryantsai/KKTerm/pull/367) — by @ryantsai)
* **SFTP/Recents UI:** Refine recents list and soften popover shadows for a cleaner look. ([#369](https://github.com/ryantsai/KKTerm/pull/369) — by @ryantsai)
* **URL Connections:** Generalize “Save password” to full **form-data** capture/restore (text inputs, selects, checkboxes/radios, etc.). ([#371](https://github.com/ryantsai/KKTerm/pull/371) — by @ryantsai)
* **SSH:** Reuse the live Session for OS detection on blank-password connections (so you don’t have icon drama after typing the password). ([#368](https://github.com/ryantsai/KKTerm/pull/368) — by @ryantsai)

## Fixed

* **Status bar:** Anchor assistant working spinner to the right of the status bar. ([#362](https://github.com/ryantsai/KKTerm/pull/362) — by @ryantsai)

* **URL Connection:** Stop native browser from clipping status notice popups. ([#364](https://github.com/ryantsai/KKTerm/pull/364) — by @ryantsai)
* **UI (SOCKS proxy fields):** Enable SOCKS proxy fields based on the displayed SOCKS server value. (by commit `aca6d2a`)
* **URL Connection:** Status notices now render above the native surface when active (no more “behind the WebView” notices). (by commit `ff32dfa`)

## Internal

* **GitHub repo hygiene:** Add project PR template. ([#370](https://github.com/ryantsai/KKTerm/pull/370) — by @ryantsai)

* **Webview/overlay work:** Improve Windows overlay handling by stripping non-client chrome and adding configuration + tests. (by commits `bf33d8f`, `561e800`, `71596af`)
* **Logging:** Add URL Connection debug logging, plus SSH debug logging for connection events/errors. (by commits `1b9e3e1`, `03ff876`)
* **RDP:** Enhance debug logging for connection lifecycle and payloads. (by commit `b703082`)
* **SFTP storage behavior (view options):** Persist per-pane file-browser view-options in the Connection DB (so look survives restarts/backups). (by commits `e0542ba`, `41e4f08`)
* **Terminal settings persistence:** Persist terminal toolbar font size via backend-valid clamped range. (by commit `9d75628`)
* **Installer docs:** Make BentoPDF service helper on-demand + installer catalog adjustments. (by commits `9c18149`, `77e18f0`, `3de803a`, `f52a04c`)

---

## 亮點（Highlights）

* **狀態列微調：** 將助理運作中的 spinner 固定在狀態列最右側（不再跑到畫面中央當迷你占位符）。

* **URL 連線可靠性：** 停止原生 WebView 的狀態通知彈窗被剪裁到嵌入式瀏覽器後面。
* **SFTP 分頁控制：** 為每個檔案 Pane 新增 **每 Pane 的檢視選項**（縮放 + 內容背景），在 SFTP/FTP Connection 裡可分別設定。

## 新增（New）

* **SFTP：** 每 Pane 的檢視選單（項目縮放 + content-view 背景），讓每個檔案 Pane 的外觀可彼此不同，並保留其設定。([#372](https://github.com/ryantsai/KKTerm/pull/372) — by @ryantsai)

* **安裝程式：** 將 **Git for Windows** 移到 **Development** 區塊。([#365](https://github.com/ryantsai/KKTerm/pull/365) — by @ryantsai)
* **安裝程式：** 讓 BentoPDF 的 **NSSM service helper** 改為 **按需安裝**。([#366](https://github.com/ryantsai/KKTerm/pull/366) — by @ryantsai)

## 改進（Improved）

* **Dashboard AI Widgets：** 用「確定性」方式提升小工具建立：確定性 source normalizer + placeholder guard。([#363](https://github.com/ryantsai/KKTerm/pull/363) — by @ryantsai)

* **Connection（終端機）：** 終端機工具列字型大小可跨啟動保存。([#367](https://github.com/ryantsai/KKTerm/pull/367) — by @ryantsai)
* **SFTP/最近使用清單 UI：** 精煉最近清單並柔化彈出視窗陰影。([#369](https://github.com/ryantsai/KKTerm/pull/369) — by @ryantsai)
* **URL Connections：** 「儲存密碼」改為支援完整 **form-data** 擷取/還原（文字輸入、選單、checkbox/radio 等）。([#371](https://github.com/ryantsai/KKTerm/pull/371) — by @ryantsai)
* **SSH：** 在「空白密碼」的情況下，改用已存在的 live Session 進行 OS 偵測（你打完密碼後不再出現圖示尷尬事件）。([#368](https://github.com/ryantsai/KKTerm/pull/368) — by @ryantsai)

## 修正（Fixed）

* **狀態列：** 將助理運作中的 spinner 固定在狀態列最右側。([#362](https://github.com/ryantsai/KKTerm/pull/362) — by @ryantsai)

* **URL 連線：** 停止原生瀏覽器剪裁狀態通知彈窗。([#364](https://github.com/ryantsai/KKTerm/pull/364) — by @ryantsai)
* **UI（SOCKS proxy 欄位）：** 依照畫面上顯示的 SOCKS server 值啟用 SOCKS proxy 欄位。([由 commit `aca6d2a`）
* **URL 連線：** 啟用狀態通知時，通知會在原生表面之上顯示（不再被 WebView 遮住）。([由 commit `ff32dfa`)

## 內部（Internal）

* **GitHub：** 新增專案 PR 範本。([#370](https://github.com/ryantsai/KKTerm/pull/370) — by @ryantsai)

* **Webview/overlay：** 改善 Windows overlay 處理（移除非 client chrome、加入設定）並附測試。([由 commits `bf33d8f`, `561e800`, `71596af`）
* **Logging：** 新增 URL Connection debug logging，以及 SSH 連線事件/錯誤的 debug logging。([由 commits `1b9e3e1`, `03ff876`）
* **RDP：** 強化連線生命週期與 payload 的除錯記錄。([由 commit `b703082`）
* **SFTP 檢視選項保存行為：** 將每 Pane 的檔案瀏覽檢視選項持久化到 Connection DB（重開/備份後外觀不會消失）。([由 commits `e0542ba`, `41e4f08`）
* **終端機設定保存：** 用後端允許的範圍對字型大小做鎖定並保存。([由 commit `9d75628`）
* **安裝程式文件/目錄：** 按需安裝 BentoPDF service helper + 安裝程式目錄調整。([由 commits `9c18149`, `77e18f0`, `3de803a`, `f52a04c`）

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.84/kkterm-0.1.84-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.84/kkterm-0.1.84-windows-arm64-setup.exe)

## v0.1.84 (KKTerm) Release Notes

### Highlights

* **RDP reliability fix:** Stop the status notice popup from “parking” the RDP Session so the remote desktop shows up again.

* **Connection UI polish:** Better inheritance for child connection icons and improved SSH OS icon detection.

### New

* None.

### Improved

* **Child Connection icons:** Child connection Tabs can inherit parent icons (rather than snapshotting), while keeping explicit icon overrides during parent metadata refresh.

* **SSH OS icon detection:** Mark SSH OS icon detection as complete after one established probe attempt.
* **Icon styling:** Update connection icon backgrounds to use rounded rectangles instead of circular badges.

### Fixed

* **RDP:** Prevent the status notice popup from permanently blocking the RDP ActiveX surface visibility (stop overlay “sticking” off-screen), fixing the case where the remote desktop never returns.
  * PR #361 by @ryantsai (claude/rdp-popup-visibility-s4y8no) — <https://github.com/ryantsai/KKTerm/pull/361>

### Internal

* None.

---

## v0.1.84（KKTerm）更新紀錄（繁體中文 / Taiwan）

### 重點

* **RDP 穩定性修正：** 修正狀態提示視窗把 RDP Session「停車」住的問題，讓遠端桌面能再次正常顯示。

* **連線介面微調：** 改善子連線分頁的圖示繼承，以及 SSH 作業系統圖示偵測。

### 新增

* 無。

### 改善

* **子連線圖示：** 子連線 Tab 會繼承父層圖示（不再是快照），且在父層中繼資料更新時會保留明確指定的圖示覆寫。

* **SSH 作業系統圖示偵測：** 當完成一次已建立的探測嘗試後，將 SSH OS 圖示偵測標記為完成。
* **圖示樣式：** 連線圖示背景改用圓角矩形，而不是圓形徽章。

### 修正

* **RDP：** 修正狀態提示視窗造成 RDP ActiveX 表面長期被遮住/被「停車」導致遠端桌面不再回來顯示的情況。
  * PR #361 by @ryantsai（claude/rdp-popup-visibility-s4y8no）— <https://github.com/ryantsai/KKTerm/pull/361>

### Internal

* 無。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.83/kkterm-0.1.83-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.83/kkterm-0.1.83-windows-arm64-setup.exe)

## Highlights

* **SSH Connections**: You can now set a **double-click requirement** for opening Connections via the Workspace setting `doubleClickOpensConnection`.

* **SSH SOCKS proxy**: Add **authenticated SOCKS SSH proxy support** and make the SOCKS proxy handling **native** (no more external `ssh + nc` dance).
* **Connections tree reliability**: Selection/opening in the Connection tree is more consistent—click targets cover the whole row, and double-click behavior is respected for child Connections.
* **URL Connection UI cleanup**: The URL Connection browser has been redesigned with an Apple-esque File Explorer-like UI, and the **status footer** was removed.

## New

* **Workspace setting `doubleClickOpensConnection`**: Require double-click to open Connections (instead of single-click). ([@ryantsai](https://github.com/ryantsai/KKTerm) in #346)

## Improved

* **Native, cross-platform SSH SOCKS proxy** with fixes to migration/readback and ensured proxy coverage. (PR #340)

* **SSH remote OS icon auto-detection**: better detection across more Unix-like systems and correct distro/OS icon mapping. (PR #348)
* **URL Connection browser** redesigned to a File Explorer Apple-esque UI. (PR #350)
* **Connection selection click behavior**: tree row is now the click target for selection. (PR #355)

## Fixed

* **AI settings secret-save failures** are now clarified so credential save issues don’t silently abort the rest of the save. (PR #338, reported/author: @ryantsai)

* **Gemini AI provider settings validation** fix. (PR #347)
* **Gemini & NVIDIA AI providers** now use **Chat Completions** for compatibility. (PR #353)
* **Connections tree click reliability amid drag detection** improved. (PR #352)
* **Double-click behavior for child Connections** now matches the parent setting. (PR #354, reported/author: @ryantsai)
* **Avoid duplicate Quick Connect creation / name collisions**. (PR #339)
* **Workspace deletion cleanup**: close open Tabs and refresh UI when deleting a workspace. (PR #342)
* **Currency converter rate refresh fallbacks** fixed. (PR #341)
* **Remove URL browser status footer** (avoids duplicated footer info / unnecessary chrome). (PR #351)
* **Preserve double-click-to-open for child connections** (row behavior). (PR #354)
* **Fix currency converter UI strings for localization**. (PR #341 includes related localization work; contributor: @ryantsai)
* **[codex] Authenticated SSH SOCKS proxy support** added. (PR #359)

## Internal

* **MCP tools catalog**: share one tool catalog and expand the built-in MCP surface. (PR #333)

* **Update localization for SSH SOCKS proxy** strings/hints across multiple languages. (PR #340 / related work; short SHA: d2c603c)
* **Test reliability**: fixes to make backend tests pass across platforms. (PR #340; includes PR review-related work)
* **Other internal UI polish / styling work** (e.g., status notice popup tones/animations). (PR #357, PR #336 reviewed work)
* **Codex authenticated SOCKS proxy support merge** and related internal updates. (PR #359; short SHA: 8fc274a)

---

## 重點

* **SSH 連線（Connection）**：新增 Workspace 設定 `doubleClickOpensConnection`，可改為需要**雙擊**才會開啟 Connection。

* **SSH SOCKS Proxy**：加入**支援驗證（authenticated）的 SOCKS SSH Proxy**，並讓 SOCKS Proxy 處理改為**原生（native）**（不用再做 `ssh + nc` 那種外部指揮操作）。
* **Connection 樹狀清單可靠度**：選取/開啟行為更一致——整列都可點選、且子 Connection 會正確遵循雙擊規則。
* **URL Connection 瀏覽器**：重新設計為類 File Explorer 的 Apple 風格 UI，並移除 **狀態頁尾（status footer）**。

## 新增

* **Workspace 設定 `doubleClickOpensConnection`**：啟用後需雙擊才能開啟 Connections（取代單擊開啟）。（#346，[@ryantsai](https://github.com/ryantsai/KKTerm)）

## 改進

* **原生且跨平台的 SSH SOCKS Proxy**，並修正 migration/readback 相關問題，且確保 proxy 作用範圍一致。 （#340）

* **SSH 遠端作業系統（remote OS）圖示自動偵測**：涵蓋更多類 Unix 系統，並正確套用 distro/OS 圖示。 （#348）
* **URL Connection 瀏覽器**改版：採用類 File Explorer 的 Apple-esque UI。 （#350）
* **Connection 選取點擊範圍**：樹狀清單的整列都可作為選取點擊目標。 （#355）

## 修正

* **AI 設定祕鑰（secret）儲存失敗**：現在會提供更清楚的錯誤回饋，避免儲存失敗時整批儲存被靜默中止。 （#338，回報/作者：@ryantsai）

* **Gemini AI provider 設定驗證**修正。 （#347）
* **Gemini & NVIDIA AI provider**：改用 **Chat Completions** 以提升相容性。 （#353）
* **Connection 樹狀清單**：拖曳偵測干擾點擊的情況修正。 （#352）
* **子 Connection 雙擊行為**：現在會正確遵循 `doubleClickOpensConnection` 設定。 （#354，回報/作者：@ryantsai）
* **避免重複建立 Quick Connect / 名稱衝突**。 （#339）
* **Workspace 刪除清理**：刪除 Workspace 時會關閉開啟的 Tab，並刷新 UI。 （#342）
* **貨幣換算器**：修正匯率重新整理的 fallback 行為。 （#341）
* **移除 URL 瀏覽器狀態頁尾**（避免重複資訊、減少無必要的頁尾 chrome）。 （#351）
* **雙擊開啟子 Connection 行為**（row 行為）。 （#354）
* **貨幣換算器字串本地化修正**。 （#341，包含相關在地化工作；貢獻者：@ryantsai）
* **[codex] 支援驗證的 SSH SOCKS Proxy**。 （#359）

## Internal

* **MCP 工具目錄（tool catalog）**：共用單一工具目錄並擴充內建 MCP surface。 （#333）

* **SSH SOCKS Proxy 多語系在地化更新**（strings/hints）。 （#340 相關工作；short SHA：d2c603c）
* **測試可靠度**：修正後端測試讓其能跨平台通過。 （#340；包含 PR review 相關工作）
* **其他內部 UI 佈景/樣式**（例如狀態提示（status notice）語氣與動畫）。 （#357、#336 相關 review 工作）
* **Codex 驗證 SOCKS Proxy 支援合併**及相關內部更新。 （#359；short SHA：8fc274a）

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.82/kkterm-0.1.82-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.82/kkterm-0.1.82-windows-arm64-setup.exe)

## Highlights

* **Drag-and-drop docking for Connection layouts**: drop a Connection onto the Workspace Canvas and dock it with an animated overlay.

* **File Browser polish**: Explorer sidebar improvements, including collapsible sections and current-folder search.
* **Docking fixes for SFTP / FTP / Pane behavior**: docked/saved SFTP panes now rehydrate as file browsers, and embedded file-browser panes correctly fill their space (no more “half-empty Split Cell” vibes).

## New

* **Drag-and-drop docking for connection layouts** (PR #329, by @ryantsai / Claude Opus 4.8): drag a Connection from the Connection Tree onto the Workspace Canvas to dock and split Panes; dropping on empty canvas opens a new Tab.

* **Collapsible explorer sidebar + current-folder search** (PR #326, by @ryantsai / Claude Opus 4.8): Finder/Explorer-style sidebar with Favorites, Common, Locations, plus a search box scoped to the current folder.

## Improved

* **File Browser remote search, status bar, connected explorer, and icon fixes** (PR #328, by @ryantsai / Claude Opus 4.8)

* **Explorer sidebar adjustments**: rename “Common Folders” → “Common”, favorites drop-to-add, and remove the incorrect hide/show hover hint (PR #327, by @ryantsai / Claude Opus 4.8)

## Fixed

* **Settings dialog height**: fixed 80% height so it doesn’t over-stretch on larger screens (PR #323, by @ryantsai / Claude Opus 4.8)

* **Icon Search layout**: keep the icon-search input beside the magnifier (PR #325, by @ryantsai / Claude Opus 4.8)
* **Connection tree icon alignment & search consistency** (PR #324, by @ryantsai / Claude Opus 4.8)
* **Dock overlay alignment with panes**: dragging to dock now highlights the correct Pane target (PR #330, by @ryantsai / Claude Opus 4.8)
* **Rehydrating docked/saved SFTP panes**: SFTP panes reopen as **file browsers**, not SSH terminals (PR #331, by @ryantsai / Claude Opus 4.8)
* **Embedded file-browser width**: embedded SFTP/FTP/File Explorer sub-Panes stretch to full pane width (PR #332, by @ryantsai / Claude Opus 4.8) — your Split Cell finally got fed.

## Internal

* docs(linux): Linux/AppImage port plan + manual-trigger release CD (PR #322, by @ryantsai / Claude Opus 4.8)

* i18n updates (including Traditional Chinese consistency) and various translation/localization follow-ups (e.g., i18n changes for settings/UI strings)
* Test coverage and docs updates related to docking and file-browser/Panes behavior
* Linux packaging/release-script and updater-related internal improvements
* Dependency/version and translation cleanups

---

## 精選重點

* **支援拖放停靠（Connection 佈局）**：把 Connection 從 Connection Tree 拖到 Workspace Canvas，並在停靠時顯示動畫提示。

* **檔案瀏覽器細節打磨**：Explorer 側欄調整、可折疊區塊與「目前資料夾」搜尋。
* **Docking 相關修正（SFTP / FTP / Pane 行為）**：停靠/儲存後的 SFTP Pane 現會正確以「檔案瀏覽器」重新載入，且內嵌的檔案瀏覽器子 Pane 會填滿空間（終於不再出現 Split Cell 像半碗空氣的情況）。

## 新增

* **拖放停靠 Connection 佈局**（PR #329，@ryantsai / Claude Opus 4.8）：把 Connection 從 Connection Tree 拖到 Workspace Canvas 來停靠與分割 Pane；拖到空白區則會開啟新的 Tab。

* **可折疊的瀏覽器側欄 + 目前資料夾搜尋**（PR #326，@ryantsai / Claude Opus 4.8）：Finder/Explorer 風格側欄（Favorites / Common / Locations），並提供僅針對目前資料夾的搜尋框。

## 改進

* **檔案瀏覽器：遠端搜尋、狀態列、已連線的 Explorer 與圖示修正**（PR #328，@ryantsai / Claude Opus 4.8）

* **Explorer 側欄調整**：把「Common Folders」改為「Common」、Favorites 支援拖曳放入新增，以及移除錯誤的隱藏/顯示懸浮提示（PR #327，@ryantsai / Claude Opus 4.8）

## 修正

* **設定視窗高度**：固定為 80% 高度，避免大螢幕上過度拉高（PR #323，@ryantsai / Claude Opus 4.8）

* **圖示搜尋配置**：讓 icon-search 輸入框維持在放大鏡**旁邊**（PR #325，@ryantsai / Claude Opus 4.8）
* **連線樹（Connection tree）圖示對齊與搜尋一致性**（PR #324，@ryantsai / Claude Opus 4.8）
* **拖放停靠覆蓋層（Dock overlay）對齊 Pane**：拖曳停靠時的高亮現在會對到正確的目標 Pane（PR #330，@ryantsai / Claude Opus 4.8）
* **停靠/儲存後 SFTP Pane 重新載入**：SFTP Pane 現會以**檔案瀏覽器**重新開啟，而不是 SSH Terminal（PR #331，@ryantsai / Claude Opus 4.8）
* **內嵌檔案瀏覽器寬度**：嵌入式 SFTP/FTP/檔案瀏覽器子 Pane 會填滿到完整 Pane 寬度（PR #332，@ryantsai / Claude Opus 4.8）— Split Cell 這次終於吃飽了。

## Internal

* docs(linux)：Linux/AppImage 佈署計畫 + 手動觸發的釋出 CD（PR #322，@ryantsai / Claude Opus 4.8）

* 多國語系（含繁中一致性）與各種在地化/翻譯後續整理（例如設定/介面字串）
* 與拖放停靠、檔案瀏覽器與 Pane 行為相關的測試與文件更新
* Linux 打包/釋出腳本與更新器（updater）相關內部改進
* 依賴版本更新與翻譯清理等內部變更

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.81/kkterm-0.1.81-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.81/kkterm-0.1.81-windows-arm64-setup.exe)

## Highlights

* Redesigned the Quick Commands dialogs to better match KKTerm’s design language (Manage / Add/Edit / Library).

* Updated Settings dialog styling: colored navigation icons, tighter typography, and a narrower dialog layout.
* Disabled autocorrect for technical inputs (so your commands stay command-like, not “helpfully” mangled).
* Fixed Delete Workspace confirmation so it uses the shared `ConfirmSheet` (danger tone) and renders consistently.

## New

* Improved workspace icon functionality and styling (including icon catalog utilities and icon color/selection support in workspace properties).

## Improved

* Settings: grouped related settings rows and improved overall layout for readability; includes Windows performance settings visibility improvements.

* Connections/Terminal UI polish:
  * Added styles for the Connection Session toggle and connection dialog input button height.
  * Updated box-shadow for the active session hint for improved visibility.

## Fixed

* Workspace: Use `ConfirmSheet` for Delete Workspace dialog (PR #321 by @ryantsai).

* Quick Commands dialogs now follow the shared dialog kit styling language more consistently (PR #318 by @ryantsai).
* Settings dialog redesign improvements (PR #320 by @ryantsai).

## Internal

* Enforced dialog footer policy by banning the dead `connection-dialog-footer` class and locking Delete Workspace to `ConfirmSheet` via a guard test.

* Added tests for material icon catalog utilities and related icon picker behavior.
* Updated input autocorrect policy test coverage for technical inputs.

---

## 亮點

* 重新設計了「快速指令（Quick Commands）」的對話框，讓 Manage / Add/Edit / Library 更符合 KKTerm 的設計語言。

* 更新了「設定（Settings）」對話框的視覺風格：彩色導覽圖示、更緊湊的字體排版，以及更窄的對話框版面。
* 已針對技術輸入停用自動修正，讓你的指令別被「好心」改到面目全非。
* 修正「刪除 Workspace」的確認流程：改用共用的 `ConfirmSheet`（danger 樣式），並確保呈現一致。

## 新功能

* 強化 Workspace 圖示的功能與樣式（包含圖示目錄工具，並支援在 Workspace 屬性中選擇圖示顏色／圖示）。

## 改進

* 設定：將相關設定列做更好的分組，並改善整體版面可讀性；同時包含對 Windows 效能設定可見性的改進。

* 連線／終端（Connections/Terminal）介面微調：
  * 為「連線 Session 切換（Connection Session toggle）」以及連線對話框的輸入按鈕高度新增樣式。
  * 更新「作用中的 Session」提示的 box-shadow，提升可視性。

## 修正

* Workspace：將「刪除 Workspace」確認對話框改為使用 `ConfirmSheet`（danger tone）。（PR #321，作者 @ryantsai）

* 「快速指令」對話框現在更一致地套用共用對話框套件（PR #318，作者 @ryantsai）。
* 設定對話框重新設計相關改進（PR #320，作者 @ryantsai）。

## 內部

* 透過測試強化對話框頁尾政策：禁止已失效的 `connection-dialog-footer` 類別，並用守護測試確保「刪除 Workspace」固定走 `ConfirmSheet`。

* 新增「材質圖示目錄（material icon catalog）」相關測試，以及圖示選擇器行為測試。
* 更新技術輸入停用自動修正的政策測試覆蓋範圍。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.80/kkterm-0.1.80-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.80/kkterm-0.1.80-windows-arm64-setup.exe)

## Highlights

* Redesigned SFTP browser + connection dialogs using the Apple/Finder-inspired design language (plus follow-up fixes to titlebar height, Finder glyphs, toolbar layout, and field styling).

* Added local **File Explorer** connection type and introduced **multiple Workspaces**, so Sessions and Tab/Panes can be scoped to the active Workspace.
* SFTP: added cut/copy/paste with local file clipboard support, plus file open actions (double-click/context menu).

## New

* Multiple Workspaces + local File Explorer connection type (PR #310, PR #309, PR #312, PR #313, PR #314, PR #315, PR #316 listed below as part of the v0.1.80 changeset).

* SFTP: single-row titlebar inside the browser (kind glyph + centered host) and queued errors shown in the titlebar / transfer activity (PR #315).
* SFTP: cut, copy, paste with local file clipboard support (shown in PR #?? via change list; see compare links below).
* SFTP: file open actions for double-click and context menu.

## Improved

* Connection Add/Edit dialogs aligned to the design language (PR #317).

* Finder-style glyphs and SFTP UI polish after the design-language merge (PR #313).
* Connection dialog surface styling consistency improvements (PR #314).

## Fixed

* SFTP Finder glyphs, toolbar pill placement, and grey Default field (PR #313).

* Consistent dialog backgrounds, flat status pill, and close-button margin (PR #314).
* Reduced the single-row SFTP titlebar height (PR #316).
* Removed screenshot/send-to-AI action from SFTP and File Explorer toolbars (PR #?).
* SFTP: errors/Not connected presentation and queue placement after titlebar redesign (PR #315).

## Internal

* README rewrites to focus on user-facing features (PR #309).

* i18n/localization updates and localization file cleanup for SFTP-related UI elements.
* Windows filesystem-path opener improvements (PR #?; see change list in compare).
* Native context-menu template icon/test updates (PR #?; see compare).
* Refactors and structure/readability work (PR #?; see compare).
* Connection workspace scoping tests and updates to Tab behavior for non-terminal connections (PR #?; see compare).
* Workspace/file explorer term translations expanded across multiple languages.

---

## 備註（繁體中文 / Taiwan）

## Highlights

* 使用 Apple/Finder 風格的設計語言，重新打造 **SFTP 瀏覽器**與**連線對話框**；並在後續加入針對「標題列高度、Finder 圖示、工具列配置、欄位樣式」的修正。

* 新增本機 **檔案總管（File Explorer）** 連線類型，並導入 **多個 Workspaces**：讓 Session 與 Tab / Pane 能依「目前的 Workspace」進行範圍化管理。
* SFTP：加入支援本機剪貼簿的 cut/copy/paste，並提供檔案開啟動作（雙擊 / 內容選單）。

## New

* 多個 Workspaces + 本機檔案總管連線類型（v0.1.80 變更集中包含 PR #310、以及其他對應 PR）。

* SFTP：瀏覽器內單列標題列（kind 圖示 + 中央主機），以及佇列中的錯誤顯示在標題列 / 傳輸活動列中（PR #315）。
* SFTP：支援本機剪貼簿的 cut、copy、paste。
* SFTP：支援雙擊與內容選單開啟檔案。

## Improved

* 連線新增/編輯（Add/Edit）對話框，改以設計語言一致化（PR #317）。

* 設計語言合併後的 Finder 圖示與 SFTP 介面微調（PR #313）。
* 對話框外觀一致性（PR #314）。

## Fixed

* 修正 SFTP 的 Finder 圖示、工具列 pill 配置、以及灰色 Default 欄位（PR #313）。

* 修正對話框背景一致性、狀態 pill 扁平化、以及關閉按鈕邊距（PR #314）。
* 修正單列 SFTP 標題列高度（PR #316）。
* 移除 SFTP 與檔案總管（File Explorer）工具列中的截圖/送去 AI 動作（PR #?）。
* SFTP：在標題列改版後，Not connected 與錯誤呈現位置調整（PR #315）。

## Internal

* README 內容重寫，聚焦使用者可見的功能（PR #309）。

* SFTP 相關 i18n/在地化更新與清理。
* Windows 檔案路徑開啟處理改善（PR #?；見比對清單）。
* 原生內容選單（context menu）範本圖示與測試更新（PR #?；見比對清單）。
* 程式結構與可讀性重構（PR #?；見比對清單）。
* Workspaces 與檔案總管的術語翻譯補全，以及非終端連線的 Tab 行為相關測試更新（PR #?；見比對清單）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.79/kkterm-0.1.79-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.79/kkterm-0.1.79-windows-arm64-setup.exe)

## Highlights

* **New “Match OS” color scheme** with **system accent color** integration—so your Dashboard colors can finally keep up with your desktop theme.

* **Dashboard edit mode gains better handling**: drag handles and resize functionality for Dashboard Widget Instances.
* **Speedtest widget upgrades**: enhanced target selection and improvements to related target handling.

## New

* **Add “Match OS” color scheme option** and integrate **system accent color**. (**a**0193d5, **2**9998b6d)

* **LibreSpeed targets for speed tests** (with updated/related tests). (**2**015c21)
* **Selectable speedtest targets** with regional options (including translations and updated manual docs). (**b**a45297)
* **Enhance QR code widget** with **dynamic canvas sizing**. (**d**375d54)

## Improved

* **Dashboard edit mode drag handle & resize** for Dashboard Widget Instances. (**2**daff9d, **b**8fad3a)

* **Script widget iframe styling enforcement** for color-scheme and background styling. (**1**955b49)
* **Localization updates** for speedtest target labels across multiple languages. (**6**2babbb)

## Fixed

* Simplify BOOL usage in `system_accent_color` function. (**a**0193d5)

## Internal

* Update source-of-truth docs for the AI harness changes. (PR from **#308**, **d**1ce349)

* Update release script variable naming for clarity and align tests. (**b**3e327e)
* Update macOS packaging scripts for base64-wrapped Minisign keys, key normalization/extraction, and signing key handling. (**0**acb095, **c**ceea67, **b**fa5778)
* Remove obsolete localization files and update translations for work plan title. (**f**ced0e8)
* Enhance hash workbench with file selection and additional hashing algorithms (MD5, CRC32) + related UI and tests. (**d**57e2ba)

---

## 重點摘要

* 新增 **「依系統」(Match OS)** 色彩方案，並整合 **系統強調色**——讓你的 Dashboard 也能跟上桌面主題的節奏。

* Dashboard 編輯模式更好用：為 **Dashboard Widget Instance** 提供拖曳把手與調整大小功能。
* Speedtest 小工具也有升級：強化測試目標選擇與相關目標處理。

## 新增

* 新增 **「依系統」(Match OS)** 色彩方案選項，並整合 **系統強調色**。(**a**0193d5, **2**9998b6d)

* **LibreSpeed 測速目標**（並更新/補強相關測試）。(**2**015c21)
* **支援可選擇的 speedtest 目標與區域選項**（含翻譯與更新手冊文件）。(**b**a45297)
* **強化 QR Code 小工具**：支援 **動態 canvas 尺寸**。(**d**375d54)

## 改善

* Dashboard 編輯模式新增 **拖曳把手**與 **調整大小**，用於 **Dashboard Widget Instance**。(**2**daff9d, **b**8fad3a)

* Script 小工具的 iframe 強制套用 **color-scheme** 與 **背景樣式**。(**1**955b49)
* 多語系更新 **speedtest 目標標籤**在翻譯內容。(**6**2babbb)

## 修正

* `system_accent_color` 函式中簡化 BOOL 用法。(**a**0193d5)

## 內部

* 更新 AI harness 變更的「單一真相來源」文件。（PR **#308**，**d**1ce349）

* 更新釋出腳本中的變數命名以提升清晰度，並對齊測試。(**b**3e327e)
* 更新 macOS 打包腳本：支援 base64 包裝的 Minisign keys、進行 key 正規化/擷取，以及 signing key 處理。(**0**acb095, **c**ceea67, **b**fa5778)
* 移除過時的在地化檔案，並更新工作計畫標題的翻譯。(**f**ced0e8)
* 強化 Hash workbench：加入檔案選擇能力與新增雜湊演算法（MD5、CRC32），並更新 UI 與相關測試。(**d**57e2ba)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.78/kkterm-0.1.78-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.78/kkterm-0.1.78-windows-arm64-setup.exe)

## Highlights

* Smarter assistant memory, work plans, and streaming harness—plus less “mystery meat” behavior in tool approvals. (PRs #307, #306)

* Dashboard script widgets now render cleanly without the opaque black backdrop border on dark backgrounds.

## New

* **Persistent per-Connection assistant memory** (global + `connection:<id>` scoped). Includes remember/recall/forget tools and Connection-aware context injection.

* **Model-driven work plans** via a new always-on `update_plan` tool. The Work panel can display per-step status and persist with the chat thread.
* **Network Tools and Generators** built-in widgets (subnet calculator, DNS lookup, speedtest, QR/barcode, cron builder, password generator, timestamp converter, hash & encoding workbench).

## Improved

* **Tool approval card risk reasons**: the approval UI can show the red warning block with specific risk notes (plus watchdog “standing-permission” note).

* **AI assistant harness safety & context discipline** improvements for Stop/approval/risk flows and MCP tool listing (to avoid hallucinated tool calls).
* **Dashboard widget contracts**: reduce duplicate widget contract token emission by sending each contract only once (attached to its governed tool).

## Fixed

* **Dashboard**: removed the opaque black backdrop border behind AI script widgets by aligning the iframe `color-scheme` with the host theme. (PR #306 by @ryantsai)

## Internal

* Added a **replay-based eval harness** for provider streams to ensure consistent parsing across live streaming vs replay fixture runs (no network call). (PR #307 by @ryantsai)

* Strengthened AI streaming/tool dispatch/testing structure (including accumulator/refactor and fixture coverage for tool-call argument fragments and reasoning).

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.77/kkterm-0.1.77-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.77/kkterm-0.1.77-windows-arm64-setup.exe)

## Highlights

* macOS: Start RDP-to-Windows sessions via IronRDP (canvas client + IME keyboard), and improve how RDP Unicode text input is handled. (PR #304)

* macOS: Fixed RDP CredSSP authentication parsing by properly splitting `DOMAIN\\user` and surfacing the real connection error. (PR #305)

## New

* macOS: Added RDP canvas view with hybrid IME keyboard handling for macOS RDP connections. (PR #304)

* macOS: Added an RDP Unicode text input path for IME/multilingual typing. (PR #304)
* macOS: Enabled macOS RDP plumbing (typed `rdp_client` commands + session manager state wiring). (PR #304)
* SFTP: Allow OS file and folder drops to the remote pane for uploads. (PR(s) in this release: installer/docs/UI were updated along with SFTP changes)
* Installer: Added install scope detection and updated the installer UI to reflect user vs system modes.

## Improved

* Dashboard: Adjusted button styles for improved visibility and consistency.

* Remote Desktop (macOS): Enhanced RDP screenshot handling and improved canvas integration.
* Quick Command dialogs: Updated Quick Command subdialog backdrop styles for improved visibility.

## Fixed

* macOS RDP CredSSP: Properly split `DOMAIN\\user` for RDP CredSSP and surface the underlying error instead of a generic “CredSSP” failure. Credits: @ryantsai. (PR #305)

* macOS RDP CredSSP: If your keyboard/network gods demand clarity, the error chain is now less likely to swallow the underlying NTLM reason (e.g., logon failure). Credits: Claude Opus (co-author), and @ryantsai for the PR. (PR #305)

## Internal

* macOS release tooling: Added a macOS DMG release helper and updated release notes patching.

* Tests: Reorganized RDP support tests for clarity and accuracy.
* i18n: Updated Indonesian translations for connection-related labels.

---

## 重點摘要

* macOS：透過 IronRDP（canvas 端＋IME 鍵盤）開始連線到 Windows 的 RDP，並提升 RDP Unicode 文字輸入的處理方式。（PR #304）

* macOS：修正 RDP CredSSP 驗證：正確拆分 `DOMAIN\\user`，並能顯示真正的連線錯誤。（PR #305）

## 新增

* macOS：加入 RDP canvas 視圖，並提供適用於 macOS RDP 連線的「混合 IME 鍵盤」處理。（PR #304）

* macOS：加入 RDP Unicode 文字輸入路徑，支援 IME/多語系輸入。（PR #304）
* macOS：啟用 macOS RDP 相關連線處理（註冊型別的 `rdp_client` 命令與 session manager 狀態串接）。（PR #304）
* SFTP：允許從作業系統直接把檔案/資料夾拖到遠端 Pane 進行上傳。
* 安裝程式：加入安裝範圍偵測，並更新 UI 以反映使用者/系統模式。

## 改進

* Dashboard：調整按鈕樣式，提升可視性與一致性。

* 遠端桌面（macOS）：強化 RDP 截圖處理並改善 canvas 整合。
* 快速指令（Quick Command）對話框：更新子對話框的背景樣式，提升可視性。

## 修正

* macOS RDP CredSSP：正確拆分 `DOMAIN\\user` 用於 RDP CredSSP，並顯示底層真正的連線錯誤（避免只看到泛用的 “CredSSP” 失敗）。致謝：@ryantsai。（PR #305）

* macOS RDP CredSSP：錯誤鏈不再那麼容易被吞掉——現在比較不會只剩一個泛化的「CredSSP」訊息，而能看見更貼近實因的 NTLM 錯誤（例如登入失敗）。致謝：Claude Opus（共同作者）與 @ryantsai（PR）（PR #305）

## Internal

* macOS 發佈流程：加入 macOS DMG 發佈輔助工具，並更新發佈說明的修補流程。

* 測試：重新整理 RDP 相關測試，讓內容更清楚且更精準。
* i18n：更新連線相關標籤的印尼文翻譯。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.76/kkterm-0.1.76-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.76/kkterm-0.1.76-windows-arm64-setup.exe)

## Highlights

* Refined Connection Tree behavior so visible connections stay in the expected order.

* Added a source-correctness contract and refreshed related tests (because terminals deserve receipts too).

## New

* **Connection Tree**: Enhanced functionality to preserve order in visible connections.

## Improved

* **Contracting for AI inputs**: Added a source-correctness contract and updated related tests.
  (PR not specified)

## Fixed

* No user-facing fixes were listed in this release context.

## Internal

* Updated AI prompt contracts and tests (`src-tauri/src/ai.rs`, `src-tauri/src/ai/prompt_contracts.rs`, `src-tauri/src/ai/tests.rs`).

* Improved Connection Tree filtering/context-menu coverage in tests (`tests/connection-tree-connected-filter.test.ts`, `tests/connection-tree-context-menu.test.mjs`).

**Full Changelog**: <https://github.com/ryantsai/KKTerm/compare/v0.1.75...v0.1.76>

---

## Highlights（繁體中文 - 台灣）

* 精進 **連線樹（Connection Tree）** 的行為，讓在畫面上可見的連線維持預期順序。

* 新增「來源正確性（source-correctness）」合約並更新相關測試——畢竟終端機也要有憑有據。

## New（新增）

* **連線樹（Connection Tree）**：強化功能，讓「可見連線」在排序上保持正確順序。

## Improved（改善）

* **AI 輸入的合約約束**：新增「來源正確性」合約並更新相關測試。
 （本次釋出內容未提供 PR 編號）

## Fixed（修正）

* 本次版本釋出內容中未列出使用者可見的修正項目。

## Internal（內部）

* 更新 AI 提示合約與測試（`src-tauri/src/ai.rs`、`src-tauri/src/ai/prompt_contracts.rs`、`src-tauri/src/ai/tests.rs`）。

* 強化連線樹篩選/內容選單相關測試（`tests/connection-tree-connected-filter.test.ts`、`tests/connection-tree-context-menu.test.mjs`）。

**完整變更紀錄（Full Changelog）**: <https://github.com/ryantsai/KKTerm/compare/v0.1.75...v0.1.76>

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.75/kkterm-0.1.75-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.75/kkterm-0.1.75-windows-arm64-setup.exe)

## Highlights

* Added a **“Show Connected”** filter to the Connection Tree so you can focus on connections with an active Session.

* When deleting a connection, KKTerm will now **close any open Tab(s) and Pane(s)** tied to it—less “stale terminal” energy, more clean state.

## New

* **Connection Tree:** Added **“Show Connected”** filter (session-only, not persisted) in the control row next to the tree view actions.
  * PR #303 — by @ryantsai (codex) · <https://github.com/ryantsai/KKTerm/pull/303> (includes fix: Hide Folders duplication)

## Improved

* **Connection Tree rendering clarity:** “Show All” was renamed to **“Hide Folders”** for clarity, and the related localization keys were updated (including **connections.hideFolders** and **connections.showConnected**).
  * PR #303 — @ryantsai · <https://github.com/ryantsai/KKTerm/pull/303>

## Fixed

* **Connection Tree duplicate roots in flat view:** Fixed a bug where root-level connections could be rendered twice when using the tree/flat combinations.
  * PR #303 — @ryantsai · <https://github.com/ryantsai/KKTerm/pull/303>

* **Deleting a connection:** Fixed lingering UI by **closing open Tabs and Panes** associated with the deleted Connection.
  * (sha: e938cb5)

## Internal

* Adjusted z-index and added related tests for the **Quick Command** subdialog backdrop. (sha: 26b64a0)

* Localization updates/todo entries across locales. (sha: aa4676f)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.74/kkterm-0.1.74-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.74/kkterm-0.1.74-windows-arm64-setup.exe)

## v0.1.74 Release Notes (KKTerm)

### Highlights

* **Fix SSH + tmux label visibility**: PTY echo no longer hides the **Pane** tmux session label when tmux is actually running.

* **Quick Connect now persists**: Quick Connect always creates/updates a saved **Connection** and opens it, instead of leaving the **Tab** backed by ephemeral state.
* **PowerShell 7 (pwsh) support**: Added as a Windows local shell option with an installer recipe and launch gating.

### New

* **Settings**: Renamed **Settings > General** section to **Window** and tidied the card layout. ([#298](https://github.com/ryantsai/KKTerm/pull/298))

* **macOS**: Added **Don’t Sleep** monitoring.
* **PowerShell 7 (pwsh)** support:
  * Shell option in Terminal settings
  * Installer recipe
  * Install-or-fallback gate for launching `pwsh`
  ([#301](https://github.com/ryantsai/KKTerm/pull/301), by @ryantsai)
* **VNC**: Added Apple Remote Desktop authentication (RFB security type 30). ([#302](https://github.com/ryantsai/KKTerm/pull/302), by @ryantsai)

### Improved

* **Quick Connect**: Always saves (reuse-or-create) and opens the persisted **Connection**. ([#300](https://github.com/ryantsai/KKTerm/pull/300))

* **Terminal/PowerShell**: `pwsh` launch is gated behind install-or-fallback pre-flight.
* **SSH / tmux UX**: Prevented a false-positive scenario that could hide the tmux session label on reconnect.

### Fixed

* **SSH**: Stop PTY echo from hiding the tmux session label. ([#297](https://github.com/ryantsai/KKTerm/pull/297), by @ryantsai)

### Internal

* Implemented a **rollback mechanism for failed releases** and validated source before mutations.

* Build tooling update: release script + installer smoke coverage updates.

---

## v0.1.74 更新日誌（KKTerm）

### 重點

* **修正 SSH + tmux 標籤可見性**：PTY 回顯不再在 **Pane** 的 tmux session 標籤被「遮住」——前提是 tmux 的確有在跑。

* **Quick Connect 會永久保存**：Quick Connect 會固定建立/更新已保存的 **Connection**，並打開它；不再讓 **Tab** 落在臨時狀態上。
* **支援 PowerShell 7（pwsh）**：新增為 Windows 本機殼層選項，並提供安裝規格與啟動門檻。

### 新增

* **設定**：將 **Settings > General** 改名為 **Window**，並整理卡片版面。([#298](https://github.com/ryantsai/KKTerm/pull/298))

* **macOS**：新增 **防止螢幕/系統休眠（Don’t Sleep）監控**。
* **PowerShell 7（pwsh）支援**：
  * Terminal 設定中的殼層選項
  * 安裝配方
  * 啟動前的 install-or-fallback 門檻
  ([#301](https://github.com/ryantsai/KKTerm/pull/301)，作者 @ryantsai)
* **VNC**：加入 Apple Remote Desktop 驗證（RFB security type 30）。([#302](https://github.com/ryantsai/KKTerm/pull/302)，作者 @ryantsai)

### 改善

* **Quick Connect**：固定儲存（reuse-or-create），並打開已持久化的 **Connection**。([#300](https://github.com/ryantsai/KKTerm/pull/300))

* **Terminal/PowerShell**：`pwsh` 啟動會先經過 install-or-fallback 的預檢。
* **SSH / tmux UX**：避免在重新連線時出現會「誤判」並隱藏 tmux 標籤的情境。

### 修正

* **SSH**：停止 PTY 回顯造成 tmux session 標籤消失的問題。([#297](https://github.com/ryantsai/KKTerm/pull/297)，作者 @ryantsai)

### Internal

* 新增 **釋出失敗回滾機制**，並在變更前先驗證來源。

* 建置/發布工具更新：更新釋出腳本與安裝煙霧測試覆蓋。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.73/kkterm-0.1.73-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.73/kkterm-0.1.73-windows-arm64-setup.exe)

## Highlights

* **Stable SSH Session keepalives**: Idle native SSH connections behind NAT/stateful firewalls are less likely to freeze—closing and reconnecting is no longer the only escape hatch.

* **macOS arm64 support**: macOS builds are updated with platform-specific behavior and native overlay title bar handling.

## New

* **(macOS) Platform-specific features** to support macOS arm64 builds, including macOS keychain integration and conditional settings rendering.

## Improved

* **“The Big Refactor” landing across the codebase** (docs + architecture + command grouping), keeping the **Connection / Session / Tab / Pane**-related surfaces organized and easier to navigate.

* **Dashboard security validation coverage** expanded with behavioral frontend tests for script widget permissions/CSP and schema validation.
* **Test auto-discovery & ESLint gate**: `npm run check` now auto-discovers tests and uses an ESLint config wired into the check pipeline.

## Fixed

* **SSH keepalives for idle Sessions** (#294, by @ryantsai) — prevents idle native SSH sessions from freezing; credited from the PR’s co-author **Claude Opus 4.8**.

## Internal

* Major internal refactors and test infrastructure work (e.g., storage/ai/module decomposition and test runners) under **The Big Refactor**.

* CI/test/tooling tweaks (Rust test gating and markdown sanitization before `dangerouslySetInnerHTML`).
* Docs/architecture updates to reflect the new backend/frontend organization.

---

## 亮點

* **穩定的 SSH Session Keepalives**：在 NAT / 有狀態防火牆之後的閒置原生 SSH 連線比較不容易凍結——不用再只靠「關掉 Tab 然後重連」才能救回來。

* **macOS arm64 支援**：更新 macOS 版的平台特定行為與原生 overlay 標題列處理。

## 新增

* **（macOS）平台特定功能**：支援 macOS arm64 建置，包括 macOS 鑰匙圈整合，以及依平台進行設定選項的條件渲染。

## 改善

* **「The Big Refactor」在整個程式碼庫落地**（含文件與架構、指令分組等），讓與 **Connection / Session / Tab / Pane** 相關的介面更好維護與理解。

* **Dashboard 安全性驗證覆蓋率擴充**：加入行為式前端測試，涵蓋 script widget 權限/CSP 與 schema 驗證。
* **測試自動發現與 ESLint gate**：`npm run check` 現在會自動發現測試，並把 ESLint 設定接到檢查流程。

## 修復

* **修正閒置 Session 的 SSH keepalives** (#294，作者 @ryantsai) — 避免閒置的原生 SSH Session 凍結；並依 PR 訊息同時致謝 **Claude Opus 4.8**（共同作者）。

## Internal

* 內部大量重構與測試/基礎設施調整（例如 storage/ai/module 拆分與測試執行器）屬於 **The Big Refactor** 的範圍。

* CI/測試/工具鏈調整（例如 Rust 測試的 CI 門檻、在 `dangerouslySetInnerHTML` 前先做 markdown sanitization）。
* 更新文件/架構以反映新的後端/前端組織方式。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.72/kkterm-0.1.72-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.72/kkterm-0.1.72-windows-arm64-setup.exe)

## Highlights

* Fixed a WebView URL overlay that could fail to show on a retry (no more “it worked… after I made a dialog do it” vibes).

## Fixed

* **Webview URL overlay visibility retry:** Added a bounded retry so the overlay show request waits until the underlying HWND is ready, preventing intermittent “underlying handle not available” failures. *(by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/292>; SHA: 176cd97)*

* **Webview URL overlay anchoring:** Anchored the overlay to the correct client origin using Win32 `ClientToScreen({0,0})`, avoiding pixel gaps beside the Pane on certain resizable/borderless Windows frames.

## Internal

* Added `.gitattributes` to enforce LF for text files, reducing CRLF-vs-LF churn that could affect tests.

* Logging: Added `KKTERM_WEBVIEW_DEBUG` output for the computed overlay rect.

---

## 亮點

* 修正 WebView 的「URL 覆蓋層」在重試時可能不會正常顯示的問題（不再需要像是「我先叫一個對話框逼它重來」那樣）。

## 修正

* **Webview URL 覆蓋層顯示重試：** 在 HWND 就緒之前加入有界重試，讓「顯示覆蓋層」的要求不會因偶發的底層手把尚未可用而失敗。*(由 @ryantsai 於 <https://github.com/ryantsai/KKTerm/pull/292；SHA：176cd97>)*

* **Webview URL 覆蓋層定位：** 透過 Win32 `ClientToScreen({0,0})` 來錨定到正確的 client origin，避免特定無邊框/可調整大小的 Windows 視窗框架下，在 Pane 旁出現幾個像素的縫隙。

## 內部

* 新增 `.gitattributes` 以強制文字檔使用 LF，降低 CRLF-vs-LF 抖動影響測試的風險。

* 記錄輸出：加入 `KKTERM_WEBVIEW_DEBUG`，顯示計算後的覆蓋層矩形資訊。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.71/kkterm-0.1.71-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.71/kkterm-0.1.71-windows-arm64-setup.exe)

## Highlights

* Fix a crash when using terminal search decorations—no more “black screen and pray” vibes.

* Improve URL webview behavior by removing an unstable Tauri webview dependency and updating how `target=_blank` opens in new Tabs.
* Fix follow-up terminal focus documentation for the URL connection flow.

## New

* Webview: opening URLs with `target=_blank` now opens in a new Tab.

## Improved

* Webview: updated lifecycle/overlay positioning logic tied to native window move/resize events.

## Fixed

* Terminal: fix crash related to terminal search decorations (#289 by @ryantsai).

* Webview: remove unstable Tauri webview dependency (#290 by @ryantsai).
* Docs: fix followup terminal focus fix URL connection docs (#291 by @ryantsai).

## Internal

* Webview/overlay handling updates included in the release (including related tests).

---

## 重點摘要

* 修正終端機搜尋的裝飾（decorations）導致的當機問題——不再有「螢幕一黑就祈禱」的尷尬感。

* 改善 URL 的 Webview 行為：移除不穩定的 Tauri Webview 相依，並更新 `target=_blank` 的開新分頁（Tab）方式。
* 修正「後續的終端機焦點」相關文件，涵蓋 URL 連線流程。

## 新增

* Webview：當連結使用 `target=_blank` 時，現在會在新的 Tab 中開啟。

## 改進

* Webview：更新了與原生視窗移動/縮放事件相關的生命週期與遮罩（overlay）定位邏輯。

## 修正

* 終端機：修正與終端機搜尋裝飾相關的當機問題（#289，@ryantsai）。

* Webview：移除不穩定的 Tauri Webview 相依（#290，@ryantsai）。
* 文件：修正「後續的終端機焦點」的 URL 連線文件（#291，@ryantsai）。

## Internal

* 本次釋出包含 Webview/遮罩處理的內部更新（並附帶相關測試）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.70/kkterm-0.1.70-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.70/kkterm-0.1.70-windows-arm64-setup.exe)

## Highlights

* Terminal keyboard focus should no longer get “stolen” when using the drag/resize frame—your Session should keep responding like a good terminal should. (Small sysadmin joke: the window finally stops grabbing the keyboard like a rogue `sudo`.)

## Fixed

* Prevented the `TAURI_DRAG_RESIZE_WINDOW` helper from stealing terminal keyboard focus, so Tabs/Session interaction won’t break on re-activation. PR #287 by @ryantsai (<https://github.com/ryantsai/KKTerm/pull/287>, c59be44 / 384b091).

## Internal

* Updated window effect behavior to keep focus handling from interfering with terminal input (WS_EX_NOACTIVATE applied to the helper window).

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.69/kkterm-0.1.69-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.69/kkterm-0.1.69-windows-arm64-setup.exe)

## Highlights

* More reliable keyboard focus for terminal input after app switching (your Alt+Tab should stop feeling like a tiny gremlin).

* Settings UI cleanup: URL WebView toolbar tidy-up and Workspace moved above Dashboard in the Settings nav.

## New

* Implement save registration and unsaved changes handling for the Settings page (including a confirmation dialog when closing with unsaved changes).

## Improved

* Tidy URL WebView toolbar and adjust Settings navigation order (Workspace above Dashboard).

## Fixed

* Restore terminal focus after app switch (e.g., Alt+Tab) via improved focus restore timing and window/visibility reactivation by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/280>.

* Hide tmux toolbar when SSH tmux negotiation falls back to normal shell by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/282>.
* Fix duplicated local terminal buffer after tab switch by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/283>.
* Fix terminal focus restore by using WebView2 MoveFocus (MoveFocus / focusCurrentWebview) instead of raising the frame by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/286>.

## Internal

* N/A

---

## 精選重點

* 讓終端機（Terminal）輸入的鍵盤焦點更可靠：切換到其他程式再回來後，鍵盤輸入不再那麼容易失聯（Alt+Tab 不該變成小小的惡作劇）。

* 設定頁面小整理：URL WebView 工具列排版更乾淨，且在設定導覽中把「Workspace」移到「Dashboard」上方。

## 新增

* 為設定頁面加入「儲存狀態登錄（save registration）」與「未儲存變更處理」：在關閉設定頁且仍有未儲存變更時會出現提示對話框。

## 改進

* 整理 URL WebView 工具列，並調整設定導覽順序（Workspace 位於 Dashboard 之上）。

## 修正

* 修復切換應用程式後終端機焦點無法正常回復（例如 Alt+Tab），透過更可靠的焦點回復時機與視窗/可見性重新啟用處理，由 @ryantsai 在 <https://github.com/ryantsai/KKTerm/pull/280> 提交。

* 當 SSH 的 tmux 協商失敗改為一般 shell 時，隱藏 tmux 工具列，由 @ryantsai 在 <https://github.com/ryantsai/KKTerm/pull/282> 提交。
* 修復切換分頁（Tab）後本機終端機緩衝（buffer）重複的問題，由 @ryantsai 在 <https://github.com/ryantsai/KKTerm/pull/283> 提交。
* 修復終端機焦點回復方式：改用 WebView2 的 MoveFocus（MoveFocus / focusCurrentWebview）而不是先把視窗框架提到最上層，由 @ryantsai 在 <https://github.com/ryantsai/KKTerm/pull/286> 提交。

## 內部

* N/A

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.68/kkterm-0.1.68-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.68/kkterm-0.1.68-windows-arm64-setup.exe)

## Highlights

* Fixed saving **Connection** properties when the same name appears more than once (duplicate-name rows).

* Refined the **Notes** widget into a skeuomorphic sticky note—because dashboards deserve a little desk clutter.
* Improved the **Settings** popup “App Update” section layout/padding for more consistent placement.

## New

* Enhanced **Connection** and Connection folder management (create/rename/delete/move, plus update tools).

## Improved

* Refined **Settings** popup “App Update” controls and placement.

## Fixed

* **Connection** properties save now works for duplicate-name rows. (via [#276](https://github.com/ryantsai/KKTerm/pull/276) by @ryantsai — reported/credited alongside the fix)

## Internal

* Refined note styling and settings popup layout via test coverage updates.

* Added tests for AI CLI status persistence.

---

## 精選重點

* 修正當同名的 **Connection** 設定列出現重複時，**Connection** 內容無法正確儲存的問題（重複名稱的列）。

* 將 **Notes** 小工具改造成擬真便利貼風格——讓儀表板也來點辦公桌的雜物感。
* 改善 **Settings** 彈出視窗中的「App Update」區塊版面/內距，讓顯示位置更一致。

## 新增

* 強化 **Connection** 與 Connection 資料夾管理：新增/更新（工具）、重新命名、刪除、移動等操作。

## 改善

* 精修 **Settings** 彈出視窗「App Update」控制項與顯示位置。

## 修正

* **Connection** 內容儲存：修正重複名稱列的儲存問題。([#276](https://github.com/ryantsai/KKTerm/pull/276) by @ryantsai — 依修正內容進行通報/署名)

## Internal

* 透過測試與樣式微調精修筆記樣式與設定彈出視窗版面。

* 新增 AI CLI 狀態持久化的測試。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.67/kkterm-0.1.67-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.67/kkterm-0.1.67-windows-arm64-setup.exe)

## Highlights

* Terminal paste is now routed through xterm handling, reducing surprise behavior when pasting into a **Pane** (PR #274, by @ryantsai).

* Improved **RDP Connection** debug logging sizing by tracking RDP connection state (PR #275, by @ryantsai). Your logs should fit a little better—like a well-sized TTY window. 😄

## New

* None

## Improved

* **Terminal** paste now goes through **xterm** paste handling (PR #274, @ryantsai).

* **RDP Connection** state is now included to resize debug logs (PR #275, @ryantsai).

## Fixed

* Fixed terminal paste handling for line breaks by routing paste through xterm (PR #274, @ryantsai).

## Internal

* None

---

## 重點摘要

* 現在會將「終端機貼上」導入 **xterm** 的處理流程，讓你在 **Pane** 裡貼上時較不會遇到令人意外的行為（PR #274，@ryantsai）。

* 改善 **RDP 連線（Connection）** 的除錯日誌大小：透過追蹤 RDP 連線狀態來調整（PR #275，@ryantsai）。日誌應該更好塞進去一點——就像剛好合適的 TTY 視窗。😄

## 新增

* 無

## 改善

* **終端機（Terminal）** 貼上現在透過 **xterm** 的貼上處理（PR #274，@ryantsai）。

* 在 **RDP 連線（RDP Connection）** 中加入狀態資訊，以調整除錯日誌大小（PR #275，@ryantsai）。

## 修正

* 修正終端機貼上時的換行問題：改為走 xterm 貼上處理（PR #274，@ryantsai）。

## Internal

* 無

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.66/kkterm-0.1.66-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.66/kkterm-0.1.66-windows-arm64-setup.exe)

## Highlights

* Improved Terminal paste handling by routing pastes through xterm handling (so your text doesn’t randomly decide to take the scenic route).

## Improved

* Route Terminal paste through xterm paste handling, fixing paste formatting/line breaks in Terminal sessions. (PR #274, @ryantsai; short SHA: `5b88126`)

## Internal

* Updated app slogan translations across multiple languages. (short SHA: `5b7c5c7`)

---

## 精選亮點

* 改進 Terminal 貼上處理：將貼上內容導回 xterm 處理流程（避免你的文字在 Terminal 裡突然改走「風景路線」）。

## 改進

* 透過 xterm paste handling 轉送 Terminal 貼上內容，修正 Terminal 會出現的貼上格式/換行問題。 (PR #274，@ryantsai；短 SHA：`5b88126`)

## Internal（內部）

* 更新多語系的應用程式標語翻譯。 (short SHA：`5b7c5c7`)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.65/kkterm-0.1.65-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.65/kkterm-0.1.65-windows-arm64-setup.exe)

## Highlights

* Added a **“Don’t Sleep”** feature to help prevent your system from sleeping while KKTerm is running.

* Improved **child connection Tab** behavior to better preserve the currently focused **Pane** state and restore layouts.

## New

* **“Don’t Sleep”** settings section (including a foreground-only mode) and updated UI labels/tooltips for its state.

## Improved

* Enhanced child **Connection** Tab behavior to preserve the focused **Pane** state and improve layout restoration.

## Fixed

## Internal

* Removed obsolete localization TODO docs and updated translations related to **“Don’t Sleep”** across multiple languages.

---

## v0.1.65 亮點

* 新增 **「不要睡眠（Don’t Sleep）」**功能：在 KKTerm 運行時，協助避免系統進入睡眠。

* 改善「子連線（child Connection）」的 **Tab** 行為：更能保留目前聚焦的 **Pane** 狀態，並讓版面還原更穩定。

## 新增

* **「不要睡眠」**設定頁面（含「僅前景（foreground-only）」模式），並同步更新介面標籤與狀態提示（tooltips）。

## 改善

* 強化子連線的 **Connection Tab** 行為：保留聚焦 **Pane** 狀態、改善版面還原效果。

## 修正

## Internal

* 移除過期的在地化 TODO 文件，並更新多語言中的「不要睡眠（Don’t Sleep）」相關翻譯。

**（小小網管笑話）**：系統要睡前，KKTerm 先把網路線按住——不然它老愛自己「晚安」。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.64/kkterm-0.1.64-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.64/kkterm-0.1.64-windows-arm64-setup.exe)

## Highlights

* Terminal Session focus restoration improvements for when you switch back to KKTerm—no more “I swear I clicked” moments. 🖥️😅

## New

* Add an “Open log folder” command in Settings (with translations updated).

## Improved

* Preserve focused Pane when the Tab refreshes within a child Connection layout.

* Color scheme updates and localization updates, including adding the **blue-green-white** color scheme.

## Fixed

* Connection Tree: Parent Child Connection Tab panoramas no longer select a child row when opened.

* Terminal: Prevent a reactivation-focused button from blocking focus restore (fix by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/268>, small terminal gremlin avoided).
* Terminal: Restore keyboard input by calling `SetFocus` on the WebView2 content HWND (fix by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/269>).
* Win32 WebView2 focus restore: Correct the `SetFocus` import path (fix by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/270>).
* Revert Win32 WebView2 focus-restore changes from #269 and #270 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/271>).

## Internal

* Terminal: Refactor focus handling and improve terminal focus restore tests.

* Dashboard/library/code cleanup and other refactors.
* Move GitHub download badge into the README badge row.

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.63/kkterm-0.1.63-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.63/kkterm-0.1.63-windows-arm64-setup.exe)

## Highlights

* Fixed a keyboard focus issue for **Terminal** Sessions after app/window activation: keystrokes now reach the right **Pane** without an extra click.

* Improved **RDP** debug logging so sensitive fields are redacted while keeping useful diagnostics, and surfaced **RDP** errors in the **Status Bar** regardless of debug settings.

## New

* Added **ui.debug.log** support for Terminal focus tracing (records focus restore stages and related document state when enabled).
  PR #9481b70

## Improved

* Enhanced **RDP** debug logging details while keeping sensitive values out of logs.
  PR #1994e86

* Updated documentation/manifests for the above debug logging and related settings language entries.
  PR #8c90114, #1994e86

## Fixed

* **Terminal** keyboard focus restoration:
  * Stopped the focus-restore loop and ensured native OS-level focus is routed into the WebView content when the Terminal **Session** becomes active.
    PR #265 (commit(s): `9769472`, `9e37a0a`)
  * Re-established input focus after app switch by restoring focus at the OS webview level (and re-acquiring the textarea focus path).
    PR #266 (commit(s): `a2bb052`)
  * Added a window-level focus command and wired it into Terminal focus restore and Session start (scoped so URL-pane child webviews are unaffected).
    PR #267 (commit(s): `060719c`, `98ecdd7`)
  * Renamed `focus_main_window` to `restore_main_window` for clarity.
    PR #? (`3857b77`)

* **RDP** error visibility:
  * **Status Bar** now shows `remoteDesktop.rdpErrorStatus` for RDP errors regardless of debug settings.
    PR #1994e86
* Sensitive field redaction in **RDP** debug logs.
  PR #1994e86

## Internal

* Refreshed architecture/release docs and manual pages for the improved debug logging and settings behavior.
  PR #8c90114, #1994e86

* Continued locale/i18n updates for the new/changed strings and debug UI support.
  PR #1994e86

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.62/kkterm-0.1.62-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.62/kkterm-0.1.62-windows-arm64-setup.exe)

## Highlights

* URL layout controls moved to the **Connection** context menu, and terminal focus restore is improved (PR [#261](https://github.com/ryantsai/KKTerm/pull/261) by @ryantsai).

* Script-widget iframe startup is deferred/staggered so Dashboard UI stalls are reduced (PR [#262](https://github.com/ryantsai/KKTerm/pull/262) by @ryantsai). Your Dashboard gets to breathe—like a terminal waiting for the prompt.

## New

* None.

## Improved

* URL layout controls are now in the **Connection** context menu (PR [#261](https://github.com/ryantsai/KKTerm/pull/261)).

* Better terminal focus restore using WebView focus (PR [#261](https://github.com/ryantsai/KKTerm/pull/261)).

## Fixed

* None.

## Internal

* Reduced Dashboard **Dashboard Widget Instance** stalls by deferring and staggering script-widget iframe startup (PR [#262](https://github.com/ryantsai/KKTerm/pull/262)).

* Script widgets are gated by viewport intersection so off-screen script-widget iframes run less JavaScript until scrolled into view (PR [#262](https://github.com/ryantsai/KKTerm/pull/262)).
* Monitoring widgets are exempt from viewport gating so periodic/realtime widgets keep updating while off-screen (PR [#262](https://github.com/ryantsai/KKTerm/pull/262)).

---

## 亮點

* 已將 **URL 佈局**控制項移到 **Connection（連線）**的內容選單，同時也強化了終端機（terminal）回復焦點的體驗（PR [#261](https://github.com/ryantsai/KKTerm/pull/261) 由 @ryantsai 貢獻）。

* Script-widget 的 iframe 啟動改為延後/分批，降低 Dashboard UI 卡頓（PR [#262](https://github.com/ryantsai/KKTerm/pull/262) 由 @ryantsai 貢獻）。Dashboard 終於能喘口氣——就像終端機在等提示字元。

## 新增

* 無。

## 改善

* **URL 佈局**控制項改放到 **Connection** 的內容選單（PR [#261](https://github.com/ryantsai/KKTerm/pull/261)）。

* 終端機焦點回復改用 WebView focus，體驗更穩定（PR [#261](https://github.com/ryantsai/KKTerm/pull/261)）。

## 修正

* 無。

## Internal

* 透過延後與分批啟動 script-widget iframe，降低 Dashboard 的 **Dashboard Widget Instance** 卡頓（PR [#262](https://github.com/ryantsai/KKTerm/pull/262)）。

* 依視窗交會（viewport intersection）對 script-widget iframe 進行上屏/延後處理：離屏時先不必啟動過多 JavaScript，直到使用者捲入（PR [#262](https://github.com/ryantsai/KKTerm/pull/262)）。
* 偵測用（monitoring）widgets 不套用離屏閘門：定期（periodic）/即時（realtime）widgets 即使離屏也能持續更新（PR [#262](https://github.com/ryantsai/KKTerm/pull/262)）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.61/kkterm-0.1.61-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.61/kkterm-0.1.61-windows-arm64-setup.exe)

## Highlights

* Refined URL Connection controls and moved layout options into the actions menu—no more fighting the toolbar like it’s a flaky terminal prompt.

* Improved the Notes Dashboard Widget instance to better match paper-like corners and realism.

## New

* Added **Send to AI** for **URL Connections**. ([#259](https://github.com/ryantsai/KKTerm/pull/259) by @ryantsai)

## Improved

* Refined URL toolbar actions by moving URL layout controls into the **actions menu**. ([#259](https://github.com/ryantsai/KKTerm/pull/259) by @ryantsai)

* Updated the Notes widget styling: squarer corners and a more realistic folded-corner curl. ([#260](https://github.com/ryantsai/KKTerm/pull/260) by @ryantsai)

## Internal

* Updated dashboard CSS for notes/table appearance and paper-corner realism. (`e5eb42d`, `6dd1545`, `700954f`)

---

## Highlights（繁體中文／台灣）

* 強化 **URL Connection** 的控制方式：把「版面配置」選項移到 **actions menu** 裡，讓你不用再跟工具列互相猜謎（就像終端機提示符偶爾會抽風一樣）。

* 改進「筆記」Dashboard Widget Instance 的外觀，讓紙感角落更逼真。

## New（新增）

* 為 **URL Connections** 新增 **Send to AI** 功能。([#259](https://github.com/ryantsai/KKTerm/pull/259) by @ryantsai)

## Improved（改進）

* 改良 URL 工具列操作：將 URL 版面配置控制項移到 **actions menu**。([#259](https://github.com/ryantsai/KKTerm/pull/259) by @ryantsai)

* 更新「筆記」Widget 樣式：角落更方、更像折角紙的自然捲曲感。([#260](https://github.com/ryantsai/KKTerm/pull/260) by @ryantsai)

## Internal（內部）

* 更新 Dashboard CSS，用於筆記/表格呈現與更逼真的紙角效果。(`e5eb42d`, `6dd1545`, `700954f`)

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.60/kkterm-0.1.60-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.60/kkterm-0.1.60-windows-arm64-setup.exe)

## Highlights

* **Notes Dashboard Widget:** Add fold-corner placement and **Markdown rendering** options for note text.

* **Remote Desktop (RDP/VNC) View Mode:** New toolbar controls plus **per-Connection persistence** and settings.
* **AI Providers:** Updated model recommendation catalog for several providers.

## New

* **Notes widget options:**
  * **Fold corner** position selection
  * **Markdown enabled** toggle for note text rendering

* **RDP/VNC:** View Mode toolbar controls, with saved behavior on a per-**Connection** basis.

## Improved

* **AI model recommendations:** Updated catalog entries for **Claude Opus 4.8**, **GPT-5.5**, **Gemini 3.5**, **Gemma 4**, and **NVIDIA Nemotron 3**.

## Fixed

* Remote Desktop view mode localization updates to match current UI labels/descriptions (light “don’t leave dangling i18n strings on the floor” energy).

## Internal

* Terminal focus behavior improvements to restore input after switching apps, including a main window focus change listener in `TerminalWorkspace`.

---

## 重要更新（繁體中文 / 台灣）

## 重點

* **Notes（筆記）Dashboard Widget：** 新增摺紙角落位置與 **Markdown 文字渲染**選項。

* **遠端桌面（RDP/VNC）檢視模式：** 新增工具列控制，並提供 **以每個 Connection（連線）為單位的保存**與設定。
* **AI 供應商：** 更新多家供應商的模型推薦清單。

## 新增

* **Notes 小工具選項：**
  * **摺紙角落（fold corner）**位置選擇
  * **Markdown 啟用**切換，用於筆記文字渲染

* **RDP/VNC：** 檢視模式工具列控制，並依每個 **Connection** 保存。

## 改進

* **AI 模型推薦：** 更新 **Claude Opus 4.8**、**GPT-5.5**、**Gemini 3.5**、**Gemma 4**、**NVIDIA Nemotron 3** 的推薦清單。

## 修正

* 遠端桌面檢視模式的在地化（i18n）內容更新，對齊目前的 UI 標籤與描述（小小提醒：別把多餘的 i18n 字串丟在地板上）。

## Internal

* 改進 Terminal 的焦點行為：在切換到其他應用後可恢復輸入；並在 `TerminalWorkspace` 加入主視窗焦點變更的事件監聽。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.59/kkterm-0.1.59-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.59/kkterm-0.1.59-windows-arm64-setup.exe)

## Highlights

* Status Bar now reflects managed X server settings, and stops polling for X server status—less “network weather forecasting”, more signal.

## Improved

* Updated the Status Bar to align with managed X server configuration changes.

## Internal

* Refreshed related context/docs and implementation to support the new Status Bar behavior.

---

## 重點摘要

* 狀態列現在會反映「已管理的 X Server」設定，並停止輪詢 X Server 狀態—少一點「網路天氣預報」，多一點確定的訊號。

## 改善

* 更新狀態列，讓它能對應已管理的 X Server 設定變更。

## 內部

* 同步更新相關的說明文件與實作，以支援新的狀態列行為。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.58/kkterm-0.1.58-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.58/kkterm-0.1.58-windows-arm64-setup.exe)

## Highlights

* Smoother SFTP path controls in your Connection: autocomplete, recent paths, and improved inline-toolbar behavior (PR #252).

* Clearer `winget` error output by decoding exit codes and adding verbose logs for installer-related actions (PR #253).
* Better handling of rejected SSH X11 forwarding status in SSH panes, so the Session doesn’t silently “faceplant” (PR #255).

## New

* Direct AI attachment submit flow to send context with fewer steps from the Assistant Panel (PR #256).

* Localized support for direct attachment prompts and improved related translations (PR #256, commit `9f13659`).

## Improved

* Improve SFTP path controls: autocomplete, recent paths, and inline-toolbar behavior (PR #252).

* Decode `winget` exit codes and enable verbose logging for install/managed-Ollama/uninstall flows to surface more actionable details (PR #253).
* Handle rejected SSH X11 forwarding status in SSH panes using server reply status (PR #255).
* X Server: improved management/wording in localization strings and UI network tool descriptions (commit `294054d`, plus PRs contributing to X Server work).

## Fixed

* Handle rejected SSH X11 forwarding status in SSH panes (PR #255).

* Decode `winget` exit codes so installer failures show readable meaning instead of raw HRESULT integers (PR #253).

## Internal

* Normalize locale JSON key order with a new script to match source locale order (commit `36a6839`).

* Localization and translation updates for new/updated UI strings (including direct attachment prompt strings and X Server-related strings; commits `9f13659`, `294054d`).
* Workspace/assistant wiring, and various related refactors and merges (commits including `4dfc31b`, `4068e08`, `b60bafb`, `c547f34`).
* Desktop wallpaper functionality was removed along with related UI/options/tests (commit `3da255b`).

---

## 亮點

* 在你的 **Connection** 裡，SFTP 路徑控制更順手：支援自動完成（autocomplete）、最近路徑（recent paths），並改善 inline-toolbar 行為（PR #252）。

* `winget` 錯誤訊息更清楚：解碼 exit code，並在安裝相關流程加入 verbose logs（PR #253）。
* 當 SSH 的 X11 forwarding 被伺服器拒絕時，SSH **pane** 會更正確處理，避免 **Session** 直接「靜靜地壞掉」(PR #255)。

## 新功能

* 新增直接提交 AI 附件（Direct AI attachment submit）流程：從 Assistant Panel 更少步驟就能帶上上下文（PR #256）。

* 新增直接附件提示（direct attachment prompt）的多語系支援，並改善相關翻譯（PR #256，commit `9f13659`）。

## 改進

* 改進 SFTP 路徑控制：autocomplete、recent paths、inline-toolbar 行為（PR #252）。

* 解碼 `winget` exit codes，並在安裝/managed-Ollama/卸載流程啟用 verbose logs，讓失敗時更容易追到原因（PR #253）。
* 依據伺服器回覆狀態處理被拒絕的 SSH X11 forwarding，在 SSH pane 中呈現更合理的行為（PR #255）。
* X Server：在多語系字串與 UI 說明（網路管理工具描述等）上做了文字/體驗面向的改進（commit `294054d`，以及參與 X Server 的相關 PR）。

## 修正

* 修正/改善被拒絕的 SSH X11 forwarding 狀態在 SSH pane 的處理（PR #255）。

* 修正 `winget` 安裝失敗時顯示原始 HRESULT 整數不易理解的問題；現在會顯示可讀的錯誤意義（PR #253）。

## Internal

* 新增腳本用來把 locale JSON 的 key 順序規範成與來源 locale 相同（commit `36a6839`）。

* 多語系/翻譯更新（包含 direct attachment prompt 與 X Server 相關字串；commits `9f13659`, `294054d`）。
* 相關工作區/助理串接、以及各種重構與合併（commits 包含 `4dfc31b`, `4068e08`, `b60bafb`, `c547f34`）。
* 移除桌面壁紙（desktop wallpaper）功能與相關 UI/選項/測試（commit `3da255b`）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.57/kkterm-0.1.57-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.57/kkterm-0.1.57-windows-arm64-setup.exe)

## Highlights

* Improve SSH “changed host key” handling with a clear warning and an explicit opt-in replacement flow.

* Better SFTP path input and restore terminal focus after popup interactions.

## New

* Dashboard design, visualization, and accessibility Assistant Skills.

* Custom assistant skills folder toggle, including optional custom skills folder + settings UI.
* Enable AI assistant network tools by default.
* Add fallback flow to replace a changed SSH host key (with explicit confirmation).

## Improved

* Reduce workspace connection frame padding (for all connection types).

* Open Windows Task Manager from status metrics.
* Reduce/troubleshoot popup dialog dismissal control inconsistencies across dialogs.
* SFTP: make the path input editable (and restore terminal focus after popup).
* Documentation updates for terminal backgrounds and UI behavior.
* CI release workflow alignment for both-arch installer publishing.
* Localization documentation: align i18n namespace docs and add Watchdog vocabulary; plus guidelines for context-specific keys and placeholder safety.

## Fixed

* Align “changed SSH host key” replacement/rotation expectations in host-key replace tests by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/251> (short SHA: 66ce06e).

## Internal

* Derive `Debug` for `SshHostKeyPreview` so host-key tests compile by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/249> (short SHA: 62c93b7).

* Derive `Debug` for SSH host key preview (test compilation unblock) by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/249> (short SHA: 71fbcfc).
* Docs / architecture / i18n alignment work items (including Watchdog terminology and source map documentation) by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/237> (short SHA: c61a740), <https://github.com/ryantsai/KKTerm/pull/240> (short SHA: 539cf03), and <https://github.com/ryantsai/KKTerm/pull/235> (short SHA: d04aed7).

---

## 精選重點

* 修正來自工作列/托盤的桌布彈出視窗託管問題，並調整桌布相關的 Connection 行為（不再讓 popup 行為像網路問題一樣「玄學」）。

* 強化 SSH「主機金鑰已變更」處理：提供清楚警告，並且需要使用者明確確認後才會替換。
* 改善 SFTP 路徑輸入，並在彈出視窗互動後恢復終端機焦點。

## 新功能

* Dashboard 設計、視覺化與無障礙 Assistant Skills。

* 自訂 assistant skills 資料夾切換：包含選用自訂 skills 資料夾與設定 UI。
* 預設啟用 AI assistant 網路工具（network tools）。
* 新增「變更後 SSH 主機金鑰替換」的備援流程（需要明確確認）。

## 改善

* 減少所有連線類型（workspace connection）的框架內距。

* 在 Windows 狀態指標中直接開啟工作管理員（Task Manager）。
* 統一/對齊多個彈出對話框的關閉控制行為。
* SFTP：讓路徑輸入可編輯（並在彈出視窗後恢復終端機焦點）。
* 補充並整理終端機背景與 UI 行為的文件。
* CI 發佈流程對齊雙架構（both-arch）安裝程式的發佈。
* 本地化文件更新：對齊 i18n namespace 文件並加入 Watchdog 詞彙；同時補上情境式 key 與 placeholder 安全性的規範。

## 修正

* 修正托盤桌布彈出視窗託管問題：@ryantsai，<https://github.com/ryantsai/KKTerm/pull/233（短> SHA: a9b9521）。

* 建立桌布 WebView 時避免使用 no-activate parent：@ryantsai，<https://github.com/ryantsai/KKTerm/pull/234（短> SHA: 3d5335b）。
* 調整 SSH 主機金鑰替換/輪替後的測試預期（host-key replace 測試）：@ryantsai，<https://github.com/ryantsai/KKTerm/pull/251（短> SHA: 66ce06e）。

## Internal

* 為 `SshHostKeyPreview` 衍生 `Debug`，以讓 host-key 測試能編譯通過：@ryantsai，<https://github.com/ryantsai/KKTerm/pull/249（短> SHA: 62c93b7）。

* 衍生 SSH 主機金鑰預覽的 `Debug`（用於測試編譯修正）：@ryantsai，<https://github.com/ryantsai/KKTerm/pull/249（短> SHA: 71fbcfc）。
* 文件 / 架構 / i18n 的對齊工作項目（包含 Watchdog 用語與 source map 文件）：@ryantsai，<https://github.com/ryantsai/KKTerm/pull/237（短> SHA: c61a740）、<https://github.com/ryantsai/KKTerm/pull/240（短> SHA: 539cf03）、以及 <https://github.com/ryantsai/KKTerm/pull/235（短> SHA: d04aed7）。

## Direct Downloads

* 💻 [Download for Windows (64-bit)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.56/kkterm-0.1.56-windows-x64-setup.exe)
* 💻 [Download for Windows (ARM64)](https://github.com/ryantsai/KKTerm/releases/download/v0.1.56/kkterm-0.1.56-windows-arm64-setup.exe)

## Highlights

* **Dashboard Notes widget**: random rotation per **Dashboard Widget Instance**, configurable rotation, and multi-page notes with tear animation.

* **Terminal appearance**: per-**Connection** terminal background + transparency improvements, including separate split-pane background support. (If your terminals could talk, they’d probably ask for a color palette.)
* **UI load smoothing**: lazy-mount dashboard views so you don’t pay the “mount everything now” tax.

## New

* **Notes widget**: per-instance random rotation, configurable rotation, and multi-page notes with tear animation. by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/227>

* **Separate split terminal backgrounds** setting. by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/>??? (included in v0.1.56 changes via background-related commits)

## Improved

* **Avoid blocking UI during MCP bridge startup**. by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/226>

* **Lazy-mount dashboard views** to avoid mounting all views at once. by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/228>
* **Per-connection terminal opacity & background picker** (UI + persistence + storage/command plumbing). by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/229>
* **Folder drag-and-drop**: improved behavior and added a visible root drop target. by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/230>

## Fixed

* **Installer (winget bootstrap)**: fixed install helper winget bootstrap and preserved failure logs in the stepper. by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/225>

* **Terminal appearance rendering**: improved background transparency handling for terminal renderer. (Included in v0.1.56 changes via terminal background/transparency commits)

## Internal

* Release note generation docs/tooling updates for direct download links in README files. edc2419

* App navigation persistence and workspace layout management improvements. 10b794d
* MCP bridge startup behavior docs/implementation updates. 582eacc
* Dashboard background popover style/structure updates. 9c84cb7
* Connection pane folder handling and related tests. 2625e8a / 60df1fc / 2625e8a
* Title bar icon + panel toggle behavior updates and related tests. 87b43f0
* Background transparency/appearance default setting work (settings + rendering + tests). e328dc7

---

## 亮點

* **儀表板 Notes 小工具**：每個 **Dashboard Widget Instance** 都有隨機旋轉、可設定旋轉角度，並支援多頁筆記與「撕裂」動畫效果。

* **終端機外觀**：讓每個 **Connection** 的終端背景與透明度（transparency）更完善，包含分割終端（split pane）可分開套用背景設定。（如果終端機會說話，大概會先問你要什麼配色。）
* **介面載入更順**：延遲掛載儀表板視圖，避免一次把所有東西都掛上去。

## 新增

* **Notes 小工具**：每個實例隨機旋轉、可設定旋轉角度、支援多頁筆記與撕裂動畫。by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/227>

* **分割終端可分開背景**設定。by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/???（v0.1.56> 內的背景相關改動一併涵蓋）

## 改進

* **避免在 MCP bridge 啟動時阻塞 UI**。by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/226>

* **延遲掛載儀表板視圖**：避免一次掛載所有視圖。by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/228>
* **每個連線（Connection）的終端透明度與背景選擇器**（UI + 持久化 + 儲存/指令串接）。by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/229>
* **資料夾拖曳**：改進拖放行為並加入清楚可見的根目錄（root）放置目標。by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/230>

## 修正

* **安裝程式（winget bootstrap）**：修正安裝程式助手 winget bootstrap，並在 stepper 中保留失敗時的日誌。by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/225>

* **終端機外觀渲染**：改進終端渲染器的背景透明度處理。（v0.1.56 內的終端背景/透明度相關改動已涵蓋）

## Internal

* 發版說明（release note）生成與文件更新：在 README 加入 Windows 安裝程式直接下載連結相關。edc2419

* App 導覽（navigation）持久化與工作區（workspace）版面管理改進。10b794d
* MCP bridge 啟動相關文件/實作更新。582eacc
* 儀表板背景彈出視窗（background popover）樣式與結構更新。9c84cb7
* 偵錯用桌布 tray 原型實作。f3e5d2c / 29fb80a
* 連線（Connection）窗格資料夾處理與相關測試。2625e8a / 60df1fc / 2625e8a
* 標題列（title bar）圖示與面板切換行為更新及測試。87b43f0
* 背景透明度/外觀預設設定工作（設定 + 渲染 + 測試）。e328dc7

## Highlights

* **More reliable tutorials navigation**: fixed tutorial match iterator handling so Tab/Pane navigation during the tutorial behaves predictably (PR #218 by @ryantsai).

* **Safer MCP bridge descriptor access**: hardened MCP bridge descriptor ACLs so other local users can’t read the descriptor on Windows (PR #220 by @ryantsai).

## New

* **Double-click header toggles** for **Connections** and **AI Assistant** panels—double-click the panel header to hide/show the panel (PR #223 by @ryantsai).

## Improved

* **Install Helper utilities** now include **Coreutils (Microsoft.Coreutils)** for winget + download provider (PR #224 by @ryantsai).

* **WebView screenshot region layering** improvements for URL WebView so the screenshot region isn’t layered incorrectly (PR #222 by @ryantsai).

## Fixed

* **Tutorial navigation test match iterator handling** (PR #218 by @ryantsai).

* **URL WebView screenshot region layering** (PR #222 by @ryantsai).
* **Harden MCP bridge descriptor ACLs** (PR #220 by @ryantsai).

## Internal

* **Docs sync** release and roadmap status (PR #219 by @ryantsai).

---

## Highlights（重點）

* **教學導覽更可靠**：修正教學比對的 iterator 處理，讓教學過程中的 Tab/Pane 導覽行為更一致（PR #218，@ryantsai）。

* **MCP 連線橋接更安全**：強化 MCP bridge descriptor 的 ACL，避免 Windows 上其他本機使用者讀取 descriptor（PR #220，@ryantsai）。

## New（新增）

* **Connections 與 AI Assistant 面板**支援「標題列雙擊切換」：雙擊面板標題即可隱藏/顯示面板（PR #223，@ryantsai）。

## Improved（改進）

* **Install Helper 工具**加入 **Coreutils（Microsoft.Coreutils）**：使用 winget + download provider（PR #224，@ryantsai）。

* **URL WebView 截圖區塊**的層級（layering）更正確，避免區塊被錯誤疊到（PR #222，@ryantsai）。

## Fixed（修正）

* **教學導覽測試比對 iterator 處理**（PR #218，@ryantsai）。

* **URL WebView 截圖區塊層級**（PR #222，@ryantsai）。
* **強化 MCP bridge descriptor ACLs**（PR #220，@ryantsai）。

## Internal（內部）

* **文件同步**：更新 release 與 roadmap 狀態（PR #219，@ryantsai）。

## v0.1.54

## Highlights

* App update download & installation is now supported in KKTerm (with user-facing update status prompts). Like a good terminal session, it tells you what’s happening—before it happens.

## New

* **App update download & installation functionality**
  * Adds UI prompts and the underlying update flow, including localized update-related strings.

* **Release script improvements**
  * Added support for a “both-arch” GitHub release script and local env file import.

## Internal

* Updated/added localization tasks and translation strings related to app update status and prompts.

* Updated release documentation and Tauri-side update implementation files.
* Added tests for app updates model and release GitHub script behavior.

---

## 亮點

* KKTerm 現已支援**下載並安裝程式更新**（搭配使用者可見的更新狀態提示）。就像一個可靠的終端機工作階段：在事情發生前就先告訴你。

## 新增

* **程式更新下載與安裝功能**
  * 提供更新提示 UI 與底層更新流程，並包含更新相關的在地化字串。

* **發佈腳本改進**
  * 新增「支援雙架構（both-arch）」的 GitHub 發佈腳本，並支援匯入本機環境檔。

## Internal（內部）

* 更新/新增與程式更新狀態與提示相關的在地化任務與翻譯字串。

* 更新發佈文件以及 Tauri 端的更新實作檔案。
* 新增 app updates model 與 release GitHub 腳本行為的測試。

## v0.1.53

## Highlights

* feat(arm64): release pipeline + arch-aware installer paths for Windows on Arm by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/214>
* Fix duplicate Activity Rail tooltips by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/215>
* Fix assistant screenshot region overlay by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/216>

**Full Changelog**: <https://github.com/ryantsai/KKTerm/compare/v0.1.52...v0.1.53>

## Changes

* Implement DialogPortal for consistent dialog rendering and update related components (c1d1b64)
* Add Quick Commands functionality to the MCP server and Assistant Panel (83281b1)
* Add FFmpeg to Utilities section and corresponding test case (d6833a3)
* Update ROADMAP.md to mark MCP server support as implemented (005c9d8)
* Refactor documentation and localization for Install Helper (5c54f96)
* Merge pull request #216 from ryantsai/codex/fix-screenshot-function-limitation (fbf9858)
* Fix assistant screenshot region overlay (84cb15e)
* Merge pull request #215 from ryantsai/codex/fix-double-tooltip-for-activity-rail-icons (5880e83)
* Fix duplicate rail tooltips (75bbaaa)
* Merge pull request #214 from ryantsai/claude/windows-arm64-builds-QgRfk (a3dd848)
* feat(arm64): release pipeline + arch-aware installer paths for Windows on Arm (9722227)

Compare: <https://github.com/ryantsai/KKTerm/compare/v0.1.52...v0.1.53>

## v0.1.52

## Highlights

* feat(packaging): add Windows on Arm (ARM64) installer build by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/198>
* Optimize workspace pane collapse animation by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/199>
* Add FFmpeg catalog entry with GitHub-release download provider and support for nested PATH in downloads by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/200>
* fix(dashboard): theme AI widget bodies with a fixed self-contained palette by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/202>
* Instrument RDP-reconnect hang to localize renderer vs UI-thread freeze by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/204>
* Increase pane resize hit target and add subtle hinge depth by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/205>
* Installer: support GitHub-release download providers, handle appx installers, and stabilize script-widget theming by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/203>
* Add assistant selection Copy context menu by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/206>
* Fix Windows build errors in heartbeat and installer by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/207>
* Use native rail tooltips over child windows by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/208>
* Install Helper: interval-gated auto update check by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/209>
* feat(release-notes): credit linked issue reporters in release notes by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/211>
* Fix SFTP drive and symlink navigation by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/212>
* Fix native tooltip PWSTR type mismatch by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/213>

**Full Changelog**: <https://github.com/ryantsai/KKTerm/compare/v0.1.51...v0.1.52>

## Changes

* Merge pull request #213 from ryantsai/codex/fix-compile-error-in-github-actions (1d49c5c)
* Fix native tooltip PWSTR type (60d18db)
* Merge pull request #212 from ryantsai/codex/fix-sftp-connection-issues-on-windows-and-linux (b342149)
* Fix SFTP drive and symlink navigation (5f8d471)
* Merge pull request #211 from ryantsai/claude/release-notes-issue-credit-Ox7Bq (476919f)
* feat(release-notes): credit linked issue reporters in release notes (40cc1d1)
* Merge pull request #209 from ryantsai/claude/installer-helper-check-caching-a4lJm (fbc4d44)
* Install Helper: interval-gated auto update check (d66bb63)
* Merge pull request #208 from ryantsai/codex/add-native-tooltip-support-for-rdp-activex (a8dc16f)
* Use native rail tooltips over child windows (cd4a902)
* Merge pull request #207 from ryantsai/claude/rust-build-errors-DigNU (f203a21)
* Fix Windows build errors in heartbeat and installer (3ad6472)
* Merge pull request #206 from ryantsai/codex/add-copy-menu-item-to-context-menu (f9181fb)
* Add assistant selection copy menu (65e4dab)
* Merge pull request #203 from ryantsai/codex/fix-winget-dependency-handling-in-installer-helper-7nugns (3bf9360)
* Merge remote-tracking branch 'origin/main' into codex/fix-winget-dependency-handling-in-installer-helper-7nugns (9cae0e5)
* Merge pull request #205 from ryantsai/codex/increase-hinge-drag-target-size-and-add-shadows (07edcee)
* Improve pane resize handles (8deb396)
* Merge pull request #204 from ryantsai/claude/kkterm-rdp-app-hangs-uq6Bm (d06fcd7)
* Merge remote-tracking branch 'origin/main' into work (5c88a5a)
* Instrument RDP-reconnect hang to localize renderer vs UI-thread freeze (b93fa3c)
* Merge pull request #202 from ryantsai/claude/ai-widget-styling-fixes-os8ZN (380b5fc)
* fix(dashboard): theme AI widget bodies with a fixed self-contained palette (6047f39)
* Merge pull request #200 from ryantsai/codex/add-ffmpeg-to-installer-helpers-catalog (4b7a385)
* Add FFmpeg installer download provider (7dcf70e)
* Merge pull request #199 from ryantsai/codex/optimize-pane-slide-animation-performance (d3b1b8a)
* Optimize workspace pane collapse animation (eae78a5)
* Merge pull request #198 from ryantsai/claude/windows-arm-compatibility-V9eR8 (3bd02a7)
* feat(packaging): add Windows on Arm (ARM64) installer build (1b72603)
* feat: add Install Helper Module to README and documentation (7f56675)

Compare: <https://github.com/ryantsai/KKTerm/compare/v0.1.51...v0.1.52>

## v0.1.51

## Highlights

* Fix URL WebView blanking when RDP session stability (WebView2) is enabled by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/193>
* Install Helper: add optional download-provider choice for winget recipes by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/194>
* Complete pending localizations by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/195>
* Fix URL webview new-window link navigation by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/196>
* Add widget health check tool and layout enforcement settings by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/197>

**Full Changelog**: <https://github.com/ryantsai/KKTerm/compare/v0.1.50...v0.1.51>

## Changes

* feat(localization): update translations for 'rainyWindow' in multiple languages (10a9bf7)
* feat(dashboard): add 'rainy window' dynamic background and update localization (e900f9b)
* feat(localization): remove obsolete dynamic backgrounds and layout enforcement documentation; update translations for new settings (ae0dd55)
* feat(sftp): update color scheme handling and improve popup dialog positioning (5d28cc2)
* feat(appearance): add 'semiconductor' color scheme and update related settings (05c5615)
* feat(installer): add FFmpeg to catalog and update related documentation (5af93ab)
* Merge branch 'main' of <https://github.com/ryantsai/KKTerm> (429a068)
* feat(i18n): add "particleCursor" to dynamic backgrounds in multiple locales (33988e6)
* Merge pull request #197 from ryantsai/claude/widget-creation-robustness-a8990 (7e2e791)
* Dashboard: same-turn widget runtime-health check + self-fix loop (3e37a0e)
* feat(dashboard): add particle cursor dynamic background and related assets (b847a22)
* Fix pre-existing non-Windows Rust build breaks blocking cargo test (85ac43d)
* feat(installer): add winget as a prerequisite for various tools and implement detection (be41b27)
* Refactor installer events and remove unused delete function from state management (76aeaed)
* Dashboard: add render-time widget layout enforcement (strict/moderate/low) (4a0230a)
* Enhance installer functionality with version comparison and update checks (620c250)
* Merge pull request #196 from ryantsai/codex/analyze-and-fix-inline-link-issue (0a8b7b1)
* Fix URL webview new-window link navigation (c22ebf8)
* Merge pull request #195 from ryantsai/codex/complete-localization-todos-and-fix-missing-keys (483e19f)
* Complete pending localizations (f0e0bc0)
* Merge pull request #194 from ryantsai/codex/add-option-to-change-installer-provider (1406b9b)
* Add download installer provider choices (5af5383)
* Merge pull request #193 from ryantsai/codex/fix-blank-url-connections-with-rdp-enabled (be131bc)
* Fix URL WebView stability args (89b97bd)

Compare: <https://github.com/ryantsai/KKTerm/compare/v0.1.50...v0.1.51>

## v0.1.50

## Highlights

* Add inline title rename for panel and hero widget presets by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/188>
* Fix watchdog lifecycle wonkiness and wire real tool-using interventions by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/189>
* Apply RDP/WebView2 stability flags reliably via additional_browser_args by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/190>
* Let AI assistant actually switch Tabs and stop tutorial hallucination by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/191>
* Expand connection folders while searching by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/192>

**Full Changelog**: <https://github.com/ryantsai/KKTerm/compare/v0.1.49...v0.1.50>

## Changes

* Merge pull request #192 from ryantsai/codex/expand-folder-by-default-on-search (be91af1)
* Expand connection folders during search (8659694)
* Merge pull request #191 from ryantsai/claude/ai-tutorial-ui-navigation-iD3BN (9bf3fc4)
* Let AI assistant actually switch Tabs and stop tutorial hallucination (c98e699)
* Merge pull request #190 from ryantsai/claude/kkterm-rdp-webview-stability-flags (1572aba)
* Apply RDP/WebView2 stability flags reliably via additional_browser_args (506b43d)
* Merge pull request #189 from ryantsai/claude/watchdog-functionality-review-QuHPA (1b3d193)
* Fix watchdog lifecycle wonkiness and wire real tool-using interventions (a134487)
* Merge pull request #188 from ryantsai/claude/translatable-widget-titles-8vDzj (5fa8698)
* Add inline title rename for panel and hero widget presets (9412ffa)

Compare: <https://github.com/ryantsai/KKTerm/compare/v0.1.49...v0.1.50>

## v0.1.49

## Highlights

* Fix AI assistant text clipping by wrapping long inline tokens by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/186>
* Harden WebView2 against RDP session disconnect hangs by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/187>

**Full Changelog**: <https://github.com/ryantsai/KKTerm/compare/v0.1.48...v0.1.49>

## Changes

* Merge pull request #187 from ryantsai/claude/kkterm-rdp-unresponsive-pAhXJ (ff72c34)
* Harden WebView2 against RDP session disconnect hangs (d7bbf16)
* Merge pull request #186 from ryantsai/claude/ai-pane-text-truncation-nMil4 (d3c0c76)
* Fix AI assistant text clipping by wrapping long inline tokens (1fad4a2)

Compare: <https://github.com/ryantsai/KKTerm/compare/v0.1.48...v0.1.49>

## Highlights

* Hermes Agent 與 OpenClaw 在 Install Helper（已安裝狀態）新增 **Run** 與 **Add to workspace**：用起來像把「開終端機」與「把 Session 存成預設」一起打包了——系統也比較不會睡過頭。

* 安裝流程的 i18n：將 Installer 相關的 **9 個待翻譯 key** 完整翻到 **13 個非英文 locale**。

## New

* Install Helper：Hermes Agent、OpenClaw（已安裝狀態）新增兩個動作按鈕
  * **Run**：開啟新 PowerShell console（Hermes venv 啟用 / OpenClaw 設定本地 npm exec alias），並在互動提示先填好指令名稱
  * **Add to workspace**：在 Connections 側邊欄新增一筆本機的 Connection（「Hermes Agent」或「OpenClaw」），每次開啟時自動啟用 venv / alias 與顯示提示

## Improved

* OpenClaw：改為 **app-local 安裝**（由 KKTerm 管理到 `%LOCALAPPDATA%\KKTerm\installer\apps\openclaw`），讓 KKTerm 對安裝、偵測與解除安裝有更直接的控制。

## Fixed

* 修正 Install Helper 的 agent 啟動流程與 web-UI launcher 問題。

* 修正與「npm + 新安裝 nvm-windows」的情境相關的偵測/啟動問題：讓受管的 managed apps 的 npm 探測與啟動使用更新後的 PATH。
* 偵測流程：在需要時改用「已更新/持久化 Windows PATH」進行 node/npm 探測，並加入回歸測試。

## Internal

* Installer i18n：翻譯 9 個 Installer 相關 key 至所有 13 個非英文 locale（含刪除 localization_todo backlog 檔），並確認 `npm run i18n:check` 通過。

* Install Helper：把安裝/偵測等工作移出 UI thread（避免像在同一個 Pane 裡又跑編譯又跑渲染那樣卡頓）。
* 多項 Install Helper 與安裝器相關的偵測/文件/測試調整（含架構與手冊更新）。
* 版本變更（整理順序/分類等）與相關測試更新。
* 偵測與版本解析修正（含回歸測試），並更新 `18-installer.md`/`ARCHITECTURE.md` 文檔。
* PR / 來源：#184、#185（by @ryantsai）。GitHub notes: <https://github.com/ryantsai/KKTerm/compare/v0.1.47...v0.1.48> （SHAs 見提交：`73f1008`, `380b0a0`, `585af86`, `59041f1`）

---

## 精選重點

* Hermes Agent 與 OpenClaw 在 Install Helper（已安裝狀態）新增 **Run** 與 **Add to workspace**：把「開終端機」和「把 Session 存成預設」一起打包，讓網路與終端工作流程更不容易卡住——就像系統比較不會半夜裝睡。

* 安裝相關 i18n：將 Installer 相關 **9 個待翻譯 key** 完整翻到 **13 個非英文 locale**。

## 新增

* Install Helper：Hermes Agent、OpenClaw（已安裝狀態）新增兩個動作按鈕
  * **Run**：開啟新的 PowerShell console（Hermes venv 啟用 / OpenClaw 設定本地 npm exec alias），並在互動提示先填好指令名稱
  * **Add to workspace**：在 Connections 側邊欄新增一筆本機 Connection（「Hermes Agent」或「OpenClaw」），每次開啟時自動啟用 venv / alias 與顯示提示

## 改進

* OpenClaw：改為 **app-local 安裝**（由 KKTerm 管理到 `%LOCALAPPDATA%\KKTerm\installer\apps\openclaw`），讓 KKTerm 對安裝、偵測與解除安裝有更直接的控制。

## 修正

* 修正 Install Helper 的 agent 啟動流程與 web-UI launcher 問題。

* 修正與「npm + 新安裝 nvm-windows」情境相關的偵測/啟動問題：讓受管的 managed apps 的 npm 探測與啟動使用更新後的 PATH。
* 偵測流程：在需要時改用「已更新/持久化 Windows PATH」進行 node/npm 探測，並加入回歸測試。

## Internal

* Installer i18n：翻譯 9 個 Installer 相關 key 至所有 13 個非英文 locale（含刪除 localization_todo backlog 檔），並確認 `npm run i18n:check` 通過。

* Install Helper：把安裝/偵測等工作移出 UI thread（避免像在同一個 Pane 裡又跑編譯又跑渲染那樣卡住）。
* 多項 Install Helper 與安裝器相關的偵測/文件/測試調整（含架構與手冊更新）。
* 版本變更（整理順序/分類等）與相關測試更新。
* 偵測與版本解析修正（含回歸測試），並更新 `18-installer.md`/`ARCHITECTURE.md` 文檔。
* PR / 來源：#184、#185（by @ryantsai）。GitHub notes: <https://github.com/ryantsai/KKTerm/compare/v0.1.47...v0.1.48> （SHAs 見提交：`73f1008`, `380b0a0`, `585af86`, `59041f1`）

## Highlights

* **Dashboard Tab Reorder**: Reorder tabs in Dashboard view (so your Session can follow your brain, not the other way around).

* **Installer improvements for managed apps**: Enhanced support around installer managed app behavior and related documentation.

## New

* **Dashboard view tab reorder** (PR #183 by @ryantsai): Lets you change the order of tabs on the Dashboard view.

## Improved

* **Installer managed app support** (commit: 3cb61ad): Expanded/updated support for installer managed apps and their related catalogs/docs.

* **Installer UI log behavior** (commit: 1489027): Installer progress now shows a single in-app command log instead of duplicate legacy rendering.
* **Installer latest-version checks** (commit: 5b45dec, 1489027): Updated winget latest-version checks to pass `--accept-source-agreements`, helping fresh Windows machines return latest versions instead of “unknown” on first winget use.

## Fixed

* **Regression coverage added**: Added regression tests around installer behaviors (including dashboard/view reorder and installer log/latest-version behaviors).

## Internal

* **Install helper catalog apps** (commit: 8903fe1): Added install helper catalog apps and updated related architecture/docs and installer code paths.

* Wired new/updated tests into `npm run check` (commits: 5b45dec, 1489027, 3cb61ad).

---

## 亮點

* **Dashboard 分頁重排序**：在 Dashboard 視圖中重排分頁（讓你的 Session 跟著你的思路走，不必反過來）。

* **受管理應用程式安裝器更新**：強化安裝器受管理應用程式相關支援與文件。

## 新增

* **Dashboard 視圖分頁重排序**（PR #183 由 @ryantsai 提供）：可調整 Dashboard 視圖分頁的順序。

## 改善

* **受管理應用程式安裝器支援**（commit：3cb61ad）：擴充/更新受管理應用程式的支援，並同步更新相關 catalogs/文件。

* **安裝器介面日誌顯示行為**（commit：1489027）：安裝進度現在只顯示一份內建的指令日誌，不再重複顯示舊版的重繪結果。
* **安裝器最新版本檢查**（commit：5b45dec、1489027）：更新 winget 最新版本檢查，改為傳入 `--accept-source-agreements`，協助全新 Windows 裝置在第一次使用 winget 時能回傳最新版本而非顯示「unknown」。

## 修正

* **加入迴歸測試覆蓋**：新增針對安裝器行為的迴歸測試（包含 Dashboard/視圖重排、安裝器日誌與最新版本檢查等）。

## Internal

* **安裝器 Helper Catalog Apps**（commit：8903fe1）：新增安裝器 helper catalog apps，並更新相關架構/文件與安裝器程式流程。

* 將新增/更新的測試接入 `npm run check`（commits：5b45dec、1489027、3cb61ad）。

## Highlights

* The Windows installer now correctly uses the right npm entrypoint (goodbye “program not found” when Node is actually there). ✅

## Fixed

* Fixed npm detection/installation in the Installer on Windows by using `npm.cmd` instead of spawning `npm` directly (while keeping `npm` elsewhere). (da2ada1)

## Internal

* Updated installer logic to wire the refreshed PATH runner through npm install/detection/uninstall flows, including npm package installs immediately after Node in the same Install Helper flow. (da2ada1)

* Documentation and installer command/detection/uninstall/install internals updated. (da2ada1)

---

## 亮點

* Windows 安裝程式現在會正確使用對的 npm 入口點（告別明明有 Node 卻還報「program not found」的狀況）。✅
（很像網管發現錯的設定檔，終於把連線救回來。）

## 修正

* 修正 Installer 在 Windows 上的 npm 偵測/安裝行為：改用 `npm.cmd` 取代直接執行 `npm`（其他平台維持使用 `npm`）。(da2ada1)

## Internal（內部）

* 更新安裝程式的流程：將更新後的 PATH runner 一併串到 npm 安裝/偵測/解除安裝等流程；並支援在同一個 Install Helper 流程中，Node 剛安裝完立刻安裝 npm 套件而不需要重開機。 (da2ada1)

* 同步更新文件與安裝程式內部的命令/偵測/解除安裝/安裝實作。 (da2ada1)

## Highlights

* Improved RDP Connection Session resizing so **remote desktop no longer starts too small** and **doesn’t require a manual Tab/Pane nudge** to settle.

* Fixed a regression where **the RDP desktop could never appear** after connect (even while the toolbar still showed **“Connected”**).

## New

* (Docs) Documented the **RDP native-window lifecycle invariant** in `ARCHITECTURE.md` so the off-screen staging vs on-screen re-apply behavior doesn’t get re-broken. (Think of it as putting a “do not touch” label on the terminal’s network cable.)

## Improved

* RDP automatic resolution (`remoteResolution=automatic`) now performs additional settle passes after the Session becomes displayable, applying the correct size without waiting for a Pane resize.

## Fixed

* Fixed RDP automatic resolution rendering at the wrong (small) size until a pane resize nudges the Tab.

* Hotfix: Fixed RDP desktop potentially never showing after the prior change (#180), caused by an off-screen settle path leaving the native window parked.
  * PR #180: <https://github.com/ryantsai/KKTerm/pull/180>
  * PR #181: <https://github.com/ryantsai/KKTerm/pull/181>

## Internal

* Split/organized connection dialog fields by type (including RDP) under `src/modules/workspace/connections/connection-dialog`.

---

## 重點摘要

* 改善 RDP Connection Session 的縮放行為：**遠端桌面不再一開始就太小**，也**不再需要手動去推一下 Tab/Pane** 才會「正常 settle」。

* 修正一個回歸問題：RDP 在連線後**可能永遠不會顯示桌面**（雖然工具列仍顯示 **「Connected」**）。

## 新增

* （文件）在 `ARCHITECTURE.md` 補上 **RDP native-window lifecycle invariant** 的說明，避免再次把「離屏 staging」和「畫面上重套用」的流程搞混。（就像在終端機網路線上貼了「不要亂拔」標籤。）

## 改善

* RDP 自動解析度（`remoteResolution=automatic`）在 Session 變得可顯示後，會額外進行 settle passes，讓 Tab/Pane 不必先被調整也能套用正確大小。

## 修正

* 修正 RDP 自動解析度剛開始會以錯誤（偏小）的大小呈現，直到面板大小被調整才會變正確。

* Hotfix：修正先前改動（#180）後，RDP 桌面可能**不會顯示**的問題；原因是某段 settle 路徑把原生視窗停放在離屏狀態。
  * PR #180: <https://github.com/ryantsai/KKTerm/pull/180>
  * PR #181: <https://github.com/ryantsai/KKTerm/pull/181>

## Internal

* 整理/拆分連線對話框的欄位，依連線類型放到 `src/modules/workspace/connections/connection-dialog`（包含 RDP）。

## Highlights

* **Status Bar visibility option**: You can now show or hide the Status Bar.

* **Dashboard updates for watchdogs**: Watchdogs now appear in the bottom-right Status Bar as soon as they emit events, with richer detail when you click.

## New

* **Show/Hide Status Bar setting** (moved Connection-rail toggle to **Workspace** settings). By @ryantsai in <https://github.com/ryantsai/KKTerm/pull/177>

* **Watchdog Status Bar experience**: New/updated UI behavior and detail panel content for watchdogs (elapsed time, watch summary, next check, exit condition, notification method, action mode). Includes docs/manual update for the Status Bar indicator. (See commits around `WatchdogStatusBar` / `WatchdogDetail`.)

## Improved

* **AI widget-design contracts**: Strengthened contracts for dashboard widget layout, contrast, and copy, and wired them into widget creation/system instructions. By @ryantsai in <https://github.com/ryantsai/KKTerm/pull/178>

## Fixed

* **Install Helper detection UI tiles**: Fixed an event payload shape mismatch so detected Install Helper progress results apply to the correct Dashboard Widget Instance keys (instead of leaving tiles stuck at “Not installed / Checked: Never”). Added regression tests. (Fix in `events.rs`.)

## Internal

* **Install Helper catalog & detection cache update**: Updated Install Helper catalog and detection cache. By @ryantsai in <https://github.com/ryantsai/KKTerm/pull/179>

* **Install Helper detection change**: Install Helper now detects winget-provider tools from a local Add/Remove Programs registry snapshot (via catalog aliases) for existing installs, while still using winget for install/update/latest-version work. (Commit `4839200`.)
* **Progress event payload tests & normalization**: Regression coverage for the corrected progress event field mapping (commit `39e5f09`).

---

## 亮點

* **狀態列顯示/隱藏選項**：你現在可以選擇顯示或隱藏 Status Bar。

* **Watchdog 相關體驗更新**：Watchdog 會在右下角狀態列中於送出事件後立刻出現；點擊後可看到更完整的細節。

## 新增

* **狀態列顯示/隱藏設定**（並將 Connection-rail 切換移到 **Workspace** 設定）。由 @ryantsai 於 <https://github.com/ryantsai/KKTerm/pull/177>

* **Watchdog Status Bar 體驗**：新的/更新的狀態列行為與明細面板內容（包含經過時間、watch summary、下一次檢查、結束條件、通知方式、action mode）。並更新文件/手冊說明狀態列指示器。（請參考 `WatchdogStatusBar` / `WatchdogDetail` 相關提交。）

## 改善

* **AI widget 設計合約強化**：加強 Dashboard Widget Instance 的版面、對比與文案（copy）合約，並串接到 dashboard_create_widget 的工具描述與系統指示中。由 @ryantsai 於 <https://github.com/ryantsai/KKTerm/pull/178>

## 修正

* **Install Helper 偵測顯示瓷磚**：修正事件 payload 結構不一致，讓 Install Helper 的偵測進度能套用到正確的 Dashboard Widget Instance 欄位；不再讓瓷磚卡在「Not installed / Checked: Never」。並加入回歸測試。（`events.rs` 修正。）

## Internal

* **更新 Install Helper 目錄與偵測快取**：更新 Install Helper 目錄與偵測快取。由 @ryantsai 於 <https://github.com/ryantsai/KKTerm/pull/179>

* **Install Helper 偵測方式調整**：Install Helper 現在會從本機「新增/移除程式」的登錄快照辨識 winget-provider 工具（透過目錄 aliases），以更正確捕捉既有安裝；安裝/更新/最新版本仍使用 winget。（提交 `4839200`。）
* **進度事件欄位映射修正測試**：加入回歸測試以涵蓋已修正的 progress event 欄位對應（提交 `39e5f09`）。

*（小吐槽一下：這次修的是 payload 的「形狀」，不是你電腦的網路。Network 先別急著重開機。）*

## Highlights

* Redesigned **Install Helper** with a popup dialog and streaming step events (less tile chaos, more terminal-friendly clarity).

* DB write latency improvements via **WAL** + **busy_timeout** to keep your UI from waiting on the network gremlins.
* Improved handling for ongoing UI flows: session teardown unblocks, and AI stream rendering is coalesced for smoother updates.

## New

* Install Helper now uses a popup-driven dialog and stepper flow, including streaming progress and per-step expandable logs. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/173>)

* Render installer/update release notes as Markdown. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/175>)
* Completed pending locale translations. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/176>)

## Improved

* Storage/DB: enabled **WAL** + **busy_timeout** to shorten DB write latency. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/174>)

* AI UI responsiveness: coalesced streamed AI renders, improved connection-tree filtering behavior, and avoided no-op CWD updates in panes. (unblocked smoother tab/pane interactions; from <https://github.com/ryantsai/KKTerm/pull/174>)
* Session handling improvements to avoid cross-session FTP/VNC shutdown blocking and to harden WebView start reservations. (from <https://github.com/ryantsai/KKTerm/pull/174>)

## Fixed

* Storage IDs: made generated IDs collision-proof using a process-wide monotonic counter (prevents UNIQUE constraint failures when IDs are generated within the same millisecond). (from <https://github.com/ryantsai/KKTerm/pull/174>)

* Install Helper console-flash storm: detection/version-check spawns now use `CREATE_NO_WINDOW`, and update checks stream incrementally so the UI doesn’t freeze on large update sets. (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/173>)
* Storage locking: recover uniformly from a poisoned mutex for better stability (instead of “lock is poisoned” until restart). (from <https://github.com/ryantsai/KKTerm/pull/174>)

## Internal

* perf/storage: recover poisoned lock uniformly; offload async-command DB work (WAL-safe import path and related storage updates). (from <https://github.com/ryantsai/KKTerm/pull/174>)

* perf/ui: coalesce AI stream renders; defer connection search filtering updates; skip no-op cwd updates. (from <https://github.com/ryantsai/KKTerm/pull/174>)
* perf(sessions): unblock cross-session FTP/VNC close; harden WebView start. (from <https://github.com/ryantsai/KKTerm/pull/174>)

---

## 重點摘要

* **安裝器助手（Install Helper）**改版：使用彈出式對話框與串流步驟事件（少一點磁磚地獄，多一點終端機式清楚）。

* 透過 **WAL** + **busy_timeout** 改善資料庫寫入延遲，避免介面因等待而卡住（不再讓 UI 跟網路惡作劇硬碰硬）。
* 強化持續進行中的流程：包含 session 關閉不卡住彼此、以及 AI 串流渲染更順暢。

## 新增

* 安裝器助手改為「彈出式對話框 + 分步步驟器（stepper）」流程，包含串流進度與每一步可展開的日誌。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/173>)

* 將更新/安裝相關的 release notes 以 Markdown 方式渲染。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/175>)
* 完成所有未完成的語系翻譯。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/176>)

## 改善

* Storage/DB：啟用 **WAL** + **busy_timeout** 以縮短 DB 寫入延遲。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/174>)

* AI 介面回應：合併 AI 串流渲染、改善連線樹（connection-tree）篩選行為、並在 Pane 中避免不必要的 CWD 無效更新（讓分頁/Pane 互動更順）。 (自 <https://github.com/ryantsai/KKTerm/pull/174>)
* Session 處理強化：避免 FTP/VNC 的跨 session 關閉互相阻塞，並強化 WebView 啟動保留（reservation）。 (自 <https://github.com/ryantsai/KKTerm/pull/174>)

## 修正

* Storage ID：使用「程序級單調遞增計數器」使生成的 ID 不會碰撞（避免同一毫秒內生成造成 UNIQUE constraint 失敗）。 (自 <https://github.com/ryantsai/KKTerm/pull/174>)

* 安裝器助手：修正 console-flash 騷擾（偵測/版本檢查啟動改用 `CREATE_NO_WINDOW`），並讓更新檢查能逐步串流，避免一次性大型更新資料導致介面凍結。 (by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/173>)
* Storage locking：一致地從 poisoned mutex 恢復（不再出現直到重啟前都報「lock is poisoned」的狀況）。 (自 <https://github.com/ryantsai/KKTerm/pull/174>)

## Internal

* perf/storage：一致地從 poisoned lock 恢復；將 async 指令的 DB 工作卸載（包含 WAL 安全的匯入路徑與相關 storage 更新）。 (自 <https://github.com/ryantsai/KKTerm/pull/174>)

* perf/ui：合併 AI 串流渲染；延後連線樹搜尋篩選更新；略過無效 cwd 更新。 (自 <https://github.com/ryantsai/KKTerm/pull/174>)
* perf(sessions)：解除跨 session FTP/VNC 關閉互相卡住；強化 WebView 啟動。 (自 <https://github.com/ryantsai/KKTerm/pull/174>)

## Highlights

* **Install Helper (Windows):** New Settings control to hide the Install Helper **icon on the Activity Rail**.

* **Dashboard widgets:** Enable **widget file drag-and-drop** from Windows Explorer into AI Created Dashboard Widgets (and improved file bridge documentation).
* **Dashboard AI Created Widgets:** Updated script editor flow for **Dashboard Widget Instance** script customization (view source now supports **Edit / Save / Cancel**).

## New

* **Install Helper module (Windows):** Adds an Install Helper **Activity Rail Module** to install, update, and uninstall a curated Windows developer tools catalog. (PR [#167](https://github.com/ryantsai/KKTerm/pull/167), [#168](https://github.com/ryantsai/KKTerm/pull/168), [#170](https://github.com/ryantsai/KKTerm/pull/170), [#171](https://github.com/ryantsai/KKTerm/pull/171), [#172](https://github.com/ryantsai/KKTerm/pull/172) by @ryantsai)

* **Settings → Install Helper:** Add a rail visibility toggle to control whether the Install Helper icon appears on the Activity Rail. (PR [#172](https://github.com/ryantsai/KKTerm/pull/172) by @ryantsai)

* **Dashboard AI script editing:** Advanced script editor for **Dashboard AI Created Widgets** with **Edit / Save / Cancel** in `View source`. (PR [#171](https://github.com/ryantsai/KKTerm/pull/171)? no—see commit below: sha `1c7cfde`)

## Improved

* **Install Helper UI:** Install Helper icons now use a **grid view** with square tiles, status dots, and expanded details while keeping the existing install/uninstall/options/log layout. (PR [#171](https://github.com/ryantsai/KKTerm/pull/171) by @ryantsai; sha `bf1ad69`)

* **Install Helper installs “stall” clarity:** Install Helper now provides heartbeat-style progress behavior (helps distinguish “actually working” vs “hung while reading”). (PR [#171](https://github.com/ryantsai/KKTerm/pull/171) by @ryantsai; sha `bf1ad69`)
* **Install Helper catalog trust model:** Switch Install Helper catalog from **remote signed** to **compile-time bundled** (shipped with the KKTerm release). (PR [#170](https://github.com/ryantsai/KKTerm/pull/170) by @ryantsai; sha `7e55a5c`)
* **Default rail visibility:** Install Helper rail icon defaults to **hidden** until users opt in from **Settings → Install Helper**. (sha `171c53c`; Settings update in PR [#172](https://github.com/ryantsai/KKTerm/pull/172))
* **Widget file drag-and-drop (Windows):** Enable **drag-and-drop** for widget files from **Windows Explorer** into AI-created dashboard widgets. (PR [#168](https://github.com/ryantsai/KKTerm/pull/168) by @ryantsai; sha `847b9a7`)

## Fixed

* **Install Helper review issues:** Address review feedback across install helper logic/UI. (sha `d76404d`)

* **Dashboard data safety across schema bumps:** Stop wiping Dashboard tables on every `SCHEMA_USER_VERSION` bump; dashboard data now drops only for `< 16`. (sha `3509d48`)

## Internal

* **Connection/session credentials:** Add reusable connection password credentials work (docs + storage/secrets related). (sha `afeabda`)

* **Custom title bar mandatory:** Make custom title bar mandatory. (sha `8de0362`)
* Version/build bump: `vsrsion bump` (sha `44a3eac`)
* Merge housekeeping: `Merge branch 'main'...` (sha `c78d005`), `Merge main into Install Helper branch` (sha `2299dca`), `Merge pull request...` (shas `838e4c5`, `3509d48`, `c78d005` etc.)

---

## 亮點

* **Install Helper（Windows）：** 新增 Settings 選項，可隱藏 **活動軌道（Activity Rail）** 上的 Install Helper 圖示。

* **儀表板小工具：** 讓你可以把 **小工具檔案** 從 **Windows 檔案總管（Explorer）** 拖曳到 AI 建立的儀表板小工具中（也補強了檔案橋接文件）。
* **Dashboard AI 建立小工具：** 已更新腳本編輯器流程；在 `View source` 現在支援 **編輯 / 儲存 / 取消**。

## 新功能

* **Install Helper 模組（Windows）：** 新增 Install Helper **活動軌道模組**，可安裝、更新與解除安裝精選的 Windows 開發工具目錄。（PR [#167](https://github.com/ryantsai/KKTerm/pull/167)、[#168](https://github.com/ryantsai/KKTerm/pull/168)、[#170](https://github.com/ryantsai/KKTerm/pull/170)、[#171](https://github.com/ryantsai/KKTerm/pull/171)、[#172](https://github.com/ryantsai/KKTerm/pull/172) 由 @ryantsai 提供）

* **Settings → Install Helper：** 新增活動軌道圖示顯示/隱藏切換。 （PR [#172](https://github.com/ryantsai/KKTerm/pull/172) 由 @ryantsai 提供）

* **Dashboard AI 腳本編輯：** Dashboard AI 建立小工具的進階腳本編輯器，在 `View source` 支援 **編輯 / 儲存 / 取消**。（提交 `1c7cfde`）

## 改進

* **Install Helper 介面：** 圖示改為 **格狀網格（grid view）**，方形磁貼搭配狀態圓點；點擊磁貼會展開詳細內容，同時保留既有的安裝/解除安裝/選項/記錄區塊。（PR [#171](https://github.com/ryantsai/KKTerm/pull/171) 由 @ryantsai；sha `bf1ad69`）

* **Install Helper 安裝更清楚：** 增加「心跳式」進度行為，幫助分辨到底是仍在運作，還是卡在讀取過程。（PR [#171](https://github.com/ryantsai/KKTerm/pull/171) 由 @ryantsai；sha `bf1ad69`）
* **Install Helper 目錄（catalog）信任模型：** 將目錄由 **遠端簽章（remote signed）** 改為 **編譯時打包（compile-time bundled）**（隨 KKTerm 發行版本一起提供）。（PR [#170](https://github.com/ryantsai/KKTerm/pull/170) 由 @ryantsai；sha `7e55a5c`）
* **預設活動軌道顯示：** Install Helper 圖示預設為 **隱藏**，直到你在 **Settings → Install Helper** 自行選擇啟用。（sha `171c53c`；Settings 更新在 PR [#172](https://github.com/ryantsai/KKTerm/pull/172)）
* **Windows 小工具拖曳檔案：** 啟用從 **Windows 檔案總管（Explorer）** 拖曳小工具檔案到 AI 建立的儀表板小工具。（PR [#168](https://github.com/ryantsai/KKTerm/pull/168) 由 @ryantsai；sha `847b9a7`）

## 修正

* **Install Helper 審查問題修正：** 修正 Install Helper 相關流程/介面中的審查回饋。（sha `d76404d`）

* **儀表板資料在 schema 更新時的保護：** 不再因為任何 `SCHEMA_USER_VERSION` 提升就清空 Dashboard 表；Dashboard 只會在 `< 16` 時才會被移除。（sha `3509d48`）

## Internal

* **連線/Session 密碼憑證：** 新增可重複使用的連線密碼憑證相關工作（含文件與 storage/secrets）。（sha `afeabda`）

* **自訂標題列強制：** 使自訂標題列成為必填。（sha `8de0362`）
* 版本/建置更新：`vsrsion bump`（sha `44a3eac`）
* 合併/維護：`Merge branch 'main'...`（sha `c78d005`）、`Merge main into Install Helper branch`（sha `2299dca`）、各種 PR 合併（shas `838e4c5`、`3509d48`、`c78d005` 等）

## Highlights

* Easier-to-use SFTP toolbar browser via a popup (because rummaging around tabs is a chore).

* Improved Connection visibility and native URL handling for RDP and webview-based Sessions.

## New

* **SFTP toolbar browser opens as a popup**. *(c5c903b)*

## Improved

* **Fix native URL handling** for webview-based functionality. *(55aacd0)*

* **Improve RDP Session visibility** behavior. *(55aacd0)*

## Fixed

* **RDP session visibility** and **native URL** issues addressed. *(55aacd0)*

* **SFTP toolbar browser presentation** corrected to use a popup. *(c5c903b)*

## Internal

* Updated documentation and tests for SFTP toolbar popup. *(c5c903b)*

* Added/updated RDP and webview visibility lifecycle tests. *(55aacd0)*

## Highlights

* Fixed App Launcher behavior so toggling **Show file extensions** no longer wipes pinned shortcuts.

* Improved Dashboard so dynamic content (including video backgrounds) continues playing when KKTerm loses OS window focus.
* Added **child connection workspace mode** for Connection tabs/Panes within a Session workspace.

## New

* **Child connection workspace mode** for Connection tabs and Pane layouts by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/166>

## Improved

* Kept Dashboard dynamic and video backgrounds playing when other OS windows take focus (animations don’t “freeze” just because you alt-tabbed) by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/161>

* Fix App Launcher icon-mode grid trailing empty slot by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/162>
* Improved connections sidebar: fixed **folder drag reorder** and added **Show All** flat connections view by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/163>
* Localized UI text for **appLauncher.showFileExtensions** and **connections.showAll** across all 13 locales by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/164>
* Added an **AI Agent contribution section** to CONTRIBUTING.md by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/165>

## Fixed

* App Launcher pinned shortcuts were wiped when toggling **Show file extensions** by @ryantsai in <https://github.com/ryantsai/KKTerm/pull/160>

* (Docs/under-the-hood) Dashboard URL WebView background popover overlap fix by @ryantsai in commits around 92993fd and 8392a4a

## Internal

* Updated docs (architecture / dashboard manual) in commits around 1d78fe9

* Added/updated regression coverage for WebView visibility lifecycle in tests/webview-visibility-lifecycle.test.mjs and wired into `npm run check` (as part of the Dashboard WebView fixes around 8392a4a)

## Highlights

* Dashboard: right-click menus should behave again when widgets overlap the canvas, and idle background animations now pause when the Dashboard isn’t actively visible (so your RTX workload can also take a nap).

* App Launcher: you can show file extensions via a new widget setting.
* RDP: Session display sync/disconnect handling was adjusted to avoid spurious “Remote desktop disconnected” states during resize/display sync.

## New

* App Launcher: added a **“Show file extensions”** setting, including the display logic (**@ryantsai** in **#159** — <https://github.com/ryantsai/KKTerm/pull/159>).

## Improved

* Dashboard: fixed widget right-click behavior so embedded Connection panes don’t eat right-click, and the widget frame menu actions remain reachable (**@ryantsai** in **#158** — <https://github.com/ryantsai/KKTerm/pull/158>).

* Dashboard: idle background animations now pause when the Dashboard is hidden, the window is minimized, or another app is in front, and resume without visual jumps.
* RDP Session: updated the resolution dropdown behavior to show **Automatic + fixed resolutions** (removed “Smart Sizing” and “DPI Zoom” from the dropdown), and normalized saved values so dead options don’t appear (**28c7b91**).

## Fixed

* Dashboard: fixed right-click and pause behavior for Dashboard background animations (**@ryantsai** in **#158** — <https://github.com/ryantsai/KKTerm/pull/158>).

* RDP: removed an “ActiveX reconnect fallback” during display sync failures that could turn a normal “resize not ready yet” into a disconnect state (**7752ccf**).
* RDP Tabs: tab auto-close behavior was moved toward event-driven Session disconnect handling (instead of the earlier polling/removed auto-close path) to prevent incorrect Tab closure timing (**8f932c2**, **ff17388**).

## Internal

* Docs & i18n alignment with the current Dashboard codebase (removed stale legacy widget/preset references; updated manuals and locale keys) (**@ryantsai** in **#157** — <https://github.com/ryantsai/KKTerm/pull/157>).

* RDP resolution options regression test added (**28c7b91**) and updated tests to validate event-driven Tab auto-close behavior (**8f932c2**).
* Terminal context menu rendering: routed through a portal so it escapes Dashboard widget transforms/overflow constraints (**be72504**).

## Highlights

* Quick Connect: embedded **elevated local terminals** are now available (because Windows UAC occasionally needs to be reminded who’s boss).

* Quick Command Bar: introduces a **Quick Command Library** with **tmux scroll handling** for faster command workflows.
* Dashboard: fixes the **tab color picker**.
* Localization: translates multiple UI areas (watchdog, settings, dashboard, and Quick Command UI) across **all 13 locales**.

## New

* Embed elevated **Quick Connect local terminals** for convenience when you need admin-level sessions. (codex, by @ryantsai in [#152](https://github.com/ryantsai/KKTerm/pull/152), [c0ccc9b])

* Quick Command Bar library + tmux scroll handling. (codex, by @ryantsai in [#155](https://github.com/ryantsai/KKTerm/pull/155), [8b7b48f])

## Improved

* Dashboard **tab color picker** fix for the right shade on the right Tab. (codex, by @ryantsai in [#154](https://github.com/ryantsai/KKTerm/pull/154), [0ad9f3f])

* Localization updates: translate watchdog, ai.watchdogApproval, settings, dashboard, and quickCommands UI strings across **all 13 locales**. (by @ryantsai in [#156](https://github.com/ryantsai/KKTerm/pull/156), [9ac23df])
* Remove wiki module and update settings export. (codex, by @ryantsai in [#153](https://github.com/ryantsai/KKTerm/pull/153), [86610f7])

## Fixed

* Fixed dashboard tab color picker. (by @ryantsai in [#154](https://github.com/ryantsai/KKTerm/pull/154), [0ad9f3f])

## Internal

* Quick Command Bar library implementation and documentation updates. (by @ryantsai in [#155](https://github.com/ryantsai/KKTerm/pull/155), [72b8f94], [tests/quick-command-library-taxonomy.test.mjs])

* Localization work includes translated Quick Command Library strings and completed localization_todo closures. (by @ryantsai, [01b64a3], [8af5ec1], [9ac23df])

## Highlights

* Workspace Tabs: double-click a Tab title for inline rename (Enter/blur saves, Escape cancels) and middle-click a Tab to close it. (If your fingers are fast, your Tabs will be, too.)

## New

* Implemented the Workspace Tab feature, including per-Tab `displayTitle` state so renaming a Tab doesn’t rename the underlying **Connection**.

## Improved

* Double-clicking a Tab title now opens inline rename; Enter/blur commits changes and Escape cancels.

## Fixed

* Renaming a Tab no longer affects the underlying **Connection** title.

## Internal

* Updated workspace manual and styling/i18n for Workspace Tabs (`workspace.css`, `04-workspace-tabs-panes.md`, and all locale files).

## Highlights

* Smarter Codex usage fallback for AI coding guidance: when the preferred refresh path doesn’t work, KKTerm can pull `/wham/usage` data from your local Codex auth (where available).

* Prevents “missing window” surprises on Windows: if the main window is restored off-screen, KKTerm relocates it so you can get back to your Tabs and Panes without the hunt.

## New

* Added a Codex `/wham/usage` fallback path for AI coding usage normalization (uses `~/.codex/auth.json` or `CODEX_HOME/auth.json`, with HTTPS/local-only filtering where applicable).
  * Preserves the full `/wham/usage` payload as raw provider JSON when this fallback path is used (so quota/limit details remain available for future explicit UI expansion).

## Improved

* Improved Windows window restore behavior: KKTerm now detects when the main window rect doesn’t overlap the Windows virtual desktop and moves/resizes the window to `0,0` at `1440x940`.
  * Runs during startup restore, tray restore, and second-instance focus.

## Fixed

* Removed the SSH/local Terminal Codex/Claude Code detection path entirely (and its UI/badge wiring), including:
  * Deleted `agentDetection.ts` and its associated detection test wiring
  * Removed terminal agent badge CSS/locale key and updated the terminal manual to stop documenting the badge
  * Added a guard test (`no-terminal-agent-detection.test.mjs`) to prevent the detection file/wiring from creeping back in

* Installer smoke test cleanup: during normal cleanup it now removes `HKCU\Software\Ryan Tsai\KKTerm` in `scripts/smoke-installer.ps1`, while skipping this deletion when `-KeepInstall` is used—matching the existing “keep cleanup artifacts” behavior. (Yes, your registry should be clean—unless you asked it not to be.)

## Internal

* None

## Highlights

* **AI watchdog:** Structured monitors with intervention and a status-bar UI—no more silent “prompt prefix that fell through to chat.” (rebased from #120) ([#140](https://github.com/ryantsai/KKTerm/pull/140), @ryantsai) *(ab10c8b / 1935910)*

* **Dashboard widget scaffolds:** New **widget archetype** scaffolding to help set up Dashboard Widget Instance foundations for **[codex]** workflows. ([#147](https://github.com/ryantsai/KKTerm/pull/147), @ryantsai) *(5b0b6e8 / 5eaad64)*

## New

* **[codex] Widget archetype scaffolds** for Dashboard Widgets (templates/scaffolds). ([#147](https://github.com/ryantsai/KKTerm/pull/147), @ryantsai) *(5b0b6e8 / 5eaad64)*

* **AI watchdog monitors with intervention** (structured monitor/actor runtime + status-bar UI). ([#140](https://github.com/ryantsai/KKTerm/pull/140), @ryantsai) *(1935910)*

## Improved

* **Terminal external links:** Shift-click an `http/https` link in **any terminal Pane** and it opens in your OS default browser. This applies across local, SSH, Telnet, and Serial terminal Sessions (shared xterm renderer). *(af9767c)*

* **Script-widget timing hardening:** Script-widget `rAF` now honors `body.lifecycle.minTickMs`, clamped with a safe lower bound; widgets without a declared cadence keep the existing default. *(ab10c8b)*

## Fixed

* **Watchdog trigger refiring** issues addressed so interventions don’t keep waking up like a misconfigured alert daemon. *(16de505)*

* **(Support change) Widget callable-library surface guidance:** Mermaid is no longer advertised/auto-inferred in the AI “Created Widget” callable library surface; related validator/schema + prompt guidance + tests updated accordingly. *(55b526a)*

## Internal

* **Removed public promotion log** from `docs/PROMOTION.md`. *(d99a366)*

* **Promotion-related docs updates** (OpenSourceAlternative, outreach email, Tauri, landing pages, feedback kit, etc.). *(2113b98, 6e9835e, 02228f8, bd61780, c6d0404, 5ca106a, e363c13, 75d8323, 5036e49, a128ba2, a6df7a7)*
* **Version bump / lockfile updates**. *(7949922)*

## Highlights

* No user-facing highlights were provided for this release. (Your terminal is still waiting for something exciting.)

## Internal

* Updated Cargo lockfiles (`.env.example`, `src-tauri/Cargo.lock`) as part of the v0.1.34 release.
  * Commit: `e2f856e` — “updated cargo lock”

## Highlights

* Dashboard Connection widget Session/Tab/Pane creation now resolves tmux IDs in an effect (reducing render-time churn and avoiding brief ID reuse when switching Connections).

* System tray/assistant “external-open” events now switch the app shell to the Workspace Module before opening/focusing the target Connection.

## New

* Added comments to `.env.example` (because even terminals like a little guidance).

## Improved

* Dashboard Connection widget: resolve tmux id in an effect using the reuse-first helper, then create the Tab/Pane from that id (instead of calling `appendTmuxSessionId()` during render). Also keyed by `connection.id` to avoid momentary reuse while switching widget Connections.
  * PRs/changes include `tests/dashboard-connection-widget-tmux.test.mjs`, `src/modules/dashboard/widgets/builtin/connections/ConnectionWidget.tsx`, and `docs/manual/10-dashboard.md` (via the same update set as <https://github.com/ryantsai/KKTerm/pull/139>).

* System tray behavior note updated in the manual to match the updated external-open flow.
  * Updated: `docs/manual/01-getting-started.md`

## Fixed

* Docs consistency updates:
  * Marked File Explorer as **planned** in architecture diagrams.
  * Corrected Dashboard animated canvas background count from 9 to 21 across all README locales (full list included in the PR).
  * Fixed contributing guide widget path from `src/dashboard/widgets/` to `src/modules/dashboard/widgets/builtin/`.
  * Replaced non-existent `mist` background reference with `ocean` in all locales.

* Updated tray/assistant external-open events so the app shell switches to the Workspace Module before opening or focusing the Connection (instead of racing ahead of the module switch).
  * Updated: `src/App.tsx`, `src/modules/workspace/connections/ConnectionSidebar.tsx`

## Internal

* Docs maintenance: pruned/reorganized `AGENTS.md` into a smaller “routing + guardrails” doc and moved the durable architectural/source-of-truth burden back to `CONTEXT.md`, `docs/ARCHITECTURE.md`, product docs, and manual docs.

* Docs/readme updates across all languages reflecting current codebase state (PR #139 by @ryantsai): <https://github.com/ryantsai/KKTerm/pull/139>

## Highlights

* App Launcher drop target now covers the full Dashboard Widget Instance body (no more “your file is hovering, but not landing”).

* URL Pane is contained to its nearest host panel (Dashboard Connection widget, embedded split Pane, or Workspace Canvas)—so it can’t spill into adjacent panes/panels.
* Custom titlebar work continues: the titlebar appearance is now theme-integrated and better aligned, with a fix to custom titlebar chrome.

## New

* **Built-in MCP server (kkterm-cli)** is now wired end-to-end and expanded (21 tools), with **Module** terminology defined. PR #135 by @ryantsai (see PR #135).

* AI Coding Usage documentation added for the **AI Coding Usage widget** and the built-in MCP server; **aider** mentions dropped. PR #137 by @ryantsai (see PR #137).

## Improved

* App Launcher icon grid row spacing adjusted so extra widget height doesn’t stretch the row tracks. (PR #132? see: “Make App Launcher drop target…” and “fixed the row spacing too.”)

* Terminal-pane containment fix for URL Pane rendering updated to document contained URL Pane behavior. (PR #136? see WebViewWorkspace containment fix details in commits; PR #136 is the src/ restructure, and the containment change is in the PR with SHA 71d9be9.)

## Fixed

* Fixed **custom titlebar chrome**. PR #134 by @ryantsai.

* Fixed **titlebar button position**. (Test referenced: `tests/titlebar-theme.test.mjs`.)
* Fixed **App Launcher drop target** to cover the full widget body. PR #132 by @ryantsai.
* Fixed **URL Pane containment** by clamping WebView2 native bounds to the nearest host panel/pane/canvas and adjusting URL webview layout behavior. (Regression coverage added via `tests/webview-toolbar-layout.test.mjs`.)
* Fixed **MCP tool input/Enter handling** for terminal sessions by mapping submit behavior to use carriage return (`\r`) with the expected “pressEnter” semantics. PR #? (commit SHA `6a9eabe`).
* Fixed **MCP config dialog** UI/behavior details (close button placement, config snippet path resolution, and opening real user config file). PR #? (commit SHA `1bd8d96`).

## Internal

* Restructured `src/` to mirror **Module** domain language. PR #136 by @ryantsai.

* Added/reworked built-in MCP server/config documentation and logging improvements (including debug JSONL logging to `mcp.debug.log`).
* Release-engineering script hardening and resilience (e.g., tolerate missing GitHub release), plus updated release tooling.
* Rendered the committed `demo.gif` in all READMEs to remove placeholder imagery. PR #138 by @ryantsai.

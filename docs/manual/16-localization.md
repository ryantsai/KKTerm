# 16 — Localization

## AI grep hints

- Keys: `settings.language`, `languages.*` (native language names)
- Topics: changing language, supported locales, source-of-truth English, dynamic locale loading, fallback
- Synonyms: "change language", "switch locale", "i18n", "translation", "中文", "繁體"

## Supported locales

| File | Language |
|------|----------|
| `en.json` | English (bundled, source of truth) |
| `fr.json` | French |
| `it.json` | Italian |
| `de.json` | German |
| `es.json` | Spanish |
| `es-MX.json` | Spanish (Mexico) |
| `pt-BR.json` | Portuguese (Brazil) |
| `zh-TW.json` | Traditional Chinese |
| `zh-CN.json` | Simplified Chinese |
| `ja.json` | Japanese |
| `ko.json` | Korean |
| `th.json` | Thai |
| `id.json` | Indonesian |
| `vi.json` | Vietnamese |

> **`vi.json` frequently falls behind.** Vietnamese was added later than the other locales and has a pattern of accumulating missing keys after feature releases. When running a localization pass, always verify `vi.json` coverage first even if the other 12 locales are complete.

Native language names come from the `languages` namespace in each locale file. English is bundled with the app; everything else loads on demand via dynamic `import()`. The active locale is persisted in `localStorage` under `kkterm.language` and survives restarts.

## Switching language

Settings → General → Language (`settings.language`). Hot-swap via `switchLanguage()` in `src/i18n/config.ts`; `ensureI18nReady()` handles startup. Changes take effect immediately — no app restart.

## Source-of-truth rules (developer-facing)

Detailed rules are in `docs/ARCHITECTURE.md` §Internationalization. Summary:

1. Every user-visible string must go through `t()` / `useTranslation()`. Bare English in JSX is a bug.
2. English changes happen in `src/i18n/locales/en.json` first.
3. Every new or changed English key gets a matching one-key file under `docs/localization_todo/` (copy `_TEMPLATE.md`) in the same change. Add this file even when an AI session adds best-effort translated values, because the todo file is the explicit localization review record.
4. Delete the corresponding `docs/localization_todo/` file only after an intentional localization pass translates the key in every non-English locale, preserves placeholders, follows regional terminology rules, and verifies the result.
5. Only update non-English locale files when intentionally translating; keep all 14 locale JSON files structurally aligned. `en.json` defines the canonical namespace/key order for every locale. Insert translated keys in the same relative position, run `pnpm run i18n:normalize` if order drifts, and always run `pnpm run i18n:check` during translation runs to compare every locale against `en.json` for missing, redundant, and misordered keys.
6. Renames must update every locale file plus the matching `docs/localization_todo/` filename.
7. Related regional locales must be translated independently. Cross-locale translation bleed is strictly forbidden even when scripts or words overlap: `zh-CN` and `zh-TW`, `es-ES` and `es-MX`, and `pt-PT` and `pt-BR` must use their own script, spelling, and regional terminology.

The `ai.tmuxSessionLabels` array is an intentional creative-label exception to literal translation: it supplies themed names for new tmux sessions, so locales may use a curated thematic set instead of translating each astronomy term one-to-one. Keep the array length stable. A shared themed set across locales is allowed when it is an explicit product choice; do not treat that exception as permission to copy sibling-locale prose or convert ordinary translations mechanically.

### CRITICAL — zh-TW must never contain Mainland Chinese terminology

`zh-TW.json` targets Traditional Chinese users in **Taiwan**. It must use Taiwan computing terminology and Taiwan phrasing — never Mainland Chinese terms, even when the characters are traditional. This is a hard review gate: any zh-TW string that uses a Mainland term is a bug that blocks the translation pass.

**Forbidden Mainland → required Taiwan term mapping** (non-exhaustive; apply the same principle to any term not listed):

| English | Mainland (forbidden in zh-TW) | Taiwan (required in zh-TW) |
|---------|-------------------------------|---------------------------|
| connection (noun) | 连接 / 連接 | 連線 |
| connect (verb) | 连接 / 連接 | 連線 |
| port | 端口 | 連接埠 |
| terminal | 终端 / 終端 | 終端機 |
| window | 窗口 | 視窗 |
| current | 当前 / 當前 | 目前 |
| save | 保存 | 儲存 |
| default | 默认 / 默認 | 預設 |
| data | 数据 / 數據 | 資料 |
| information | 信息 | 資訊 |
| software | 软件 / 軟件 | 軟體 |
| network | 网络 / 網絡 | 網路 |
| mouse | 鼠标 / 鼠標 | 滑鼠 |
| access | 访问 / 訪問 | 存取 |
| memory | 内存 / 內存 | 記憶體 |
| disk | 硬盘 / 硬盤 | 硬碟 |
| print | 打印 | 列印 |
| help | 帮助 / 幫助 | 說明 |
| search | 搜索 | 搜尋 |
| client | 客户端 (Mainland spelling) / 用戶端 | 客戶端 |
| server | 服务器 / 服務器 | 伺服器 |
| wildcard | 通配符 | 萬用字元 |
| loopback | 回环 / 回環 | 回送 |
| interface | 接口 | 介面 |
| remote | 远程 / 遠程 | 遠端 |
| user | 用户 / 用戶 | 使用者 |
| program (code) | 程序 | 程式 |
| process | 进程 / 進程 | 處理程序 |
| screen | 屏幕 | 螢幕 |
| menu | 菜单 / 菜單 | 選單 |
| cursor | 光标 / 光標 | 游標 |
| video | 视频 / 視頻 | 影片 |
| audio | 音频 / 音頻 | 音訊 |
| activate | 激活 / 激話 | 啟用 |
| username | 用户名 / 用戶名 | 使用者名稱 |
| sender | 发件人 / 發件人 | 寄件人 |
| folder | 文件夹 / 文件夾 | 資料夾 |
| File Explorer | 文件资源管理器 | 檔案總管 |
| load | 加载 / 加載 | 載入 |
| package | 软件包 / 軟件包 | 套件 |

**Notes:**
- `連接埠` (port) is correct Taiwan terminology — the `連接` in `連接埠` is not a Mainland term; it's a compound noun. The standalone verb/noun `連接` for "connect/connection" is what must become `連線`.
- `處理程序` (process) is the Taiwan term — do not confuse with `程序` (program, Mainland).
- All characters must be traditional, never simplified.
- When in doubt, consult an established Taiwan computing glossary. Do not copy from `zh-CN.json` and convert characters — the vocabulary itself differs.
8. Prefer context-specific keys over reusing one key. When a single English word covers meanings that other languages translate differently — e.g. "Play" for start-media vs. run vs. a theatrical play — add a separate key per context and name it after the meaning, not the spelling. Reuse a key only when the meaning is identical everywhere it appears.
9. Keep placeholders translation-safe. Use named i18next placeholders (`{{count}}`, `{{host}}`) so translators can reorder them, keep one full sentence per key (never concatenate keys or fragments around a variable), and confirm every `{{…}}` token survives unchanged in each locale. Prefer i18next plural/context features over English-shaped string assembly.

Technical terms (SSH, SFTP, RDP, VNC, tmux, ProxyJump, PowerShell, WSL, API, URL) typically stay English across languages.

## Namespaces

`app`, `settings`, `connections`, `terminal`, `sftp`, `webview`, `remoteDesktop`, `ai`, `watchdog`, `workspace`, `common`, `languages`, `manual`, plus feature namespaces `dashboard`, `appLauncher`, `installer`, `itops`, `git`, `compare`. Each chapter of this manual lists which namespaces are in scope.

## Typed key autocomplete

In TypeScript code, `useT()` from `src/i18n/useT.ts` autocompletes keys from the English JSON shape. Outside React, import `i18next` from `src/i18n/config.ts` and call `i18next.t(key)` directly.

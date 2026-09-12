# Localization Backlog

![Downloads](https://img.shields.io/github/downloads/ryantsai/KKTerm/total)

Each pending English string lives in its own file in this directory. One key per file. This replaces the previous single `docs/LOCALIZATION.md` so feature branches can add or remove pending strings without colliding.

## Filename Convention

`<namespace>.<keyPath>.md` — dots from the i18n key path stay as dots, slashes are not allowed.

Examples:
- `ai.dashboardToolsDisabledTitle.md`
- `settings.general.languageHint.md`

## Flow

Every new or changed user-visible English key added to `src/i18n/locales/en.json`
must get a matching `docs/localization_todo/<namespace>.<keyPath>.md` file in
the same change. Add the file even when you also add best-effort translations to
every non-English locale, because the backlog is the explicit review record for
new translation work. Before finishing, run `pnpm run i18n:check` to prove every
locale contains the key in the same relative order.

Do not skip the todo file just because an AI coding session filled in translated
values. Treat direct translations as complete only when the session is
intentionally doing a localization pass, preserves every placeholder, respects
regional terminology rules, runs the checks below, and removes the matching todo
file as part of that verified translation work. Otherwise, keep the todo file so
the key remains visible for localization review.

### When translations already exist while a todo file remains

A todo file may outlive the moment translations were first written into the
non-English locale files (for example because a feature branch added best-effort
translations but never ran the verification pass, or because the English value
later changed and the todo file was re-created). In that case the existing
translations are not automatically correct — treat them as a starting point,
not a finished result.

Before deleting the todo file, perform a verification pass against the todo
file's **Context/meaning**, **Domain notes**, and **Placeholders** fields for
every locale:

1. Open `src/i18n/locales/<locale>.json` and read the current translated value
   for the key.
2. Confirm it matches the specific sense documented in the todo file, not a
   different meaning of the same English word. Re-read the English value and
   the todo file's **Context/meaning** before judging; a literal earlier
   translation may have fit a previous sense that no longer applies.
3. Confirm every placeholder (such as `{{count}}`, `{{host}}`) survives
   verbatim and in the same number; placeholders are part of the string
   contract, not optional decoration.
4. Confirm regional terminology and script rules — especially the zh-TW rule
   below — and that the value was not copied from a sibling locale.
5. Fix any value that does not fit the context, then run `pnpm run i18n:check`.
6. Only after every locale passes the checks above, **delete** the todo file.

If you cannot verify a locale (for example you are not confident in the
regional terminology), keep the todo file rather than deleting it on trust.

When you add or change an English key in `src/i18n/locales/en.json` and do **not** translate it into the other 13 locales in the same change:

1. Copy `_TEMPLATE.md` to `<namespace>.<keyPath>.md`.
2. Fill in every field.
3. Keep the English key in its intended namespace position; `en.json` is the source of truth for locale key order.
4. Commit the file alongside the `en.json` change.

When you (or a localization pass) translate the key into every supported locale:

1. Update each non-English locale file under `src/i18n/locales/`.
2. Insert translated keys in the same relative order as `src/i18n/locales/en.json`; run `pnpm run i18n:normalize` if a locale drifts.
3. For related regional locales, translate independently instead of copying from the sibling locale. Cross-locale translation bleed is forbidden even when scripts or words look similar: `zh-CN` and `zh-TW`, `es-ES` and `es-MX`, and `pt-PT` and `pt-BR` must use their own script, spelling, and regional terminology.

`ai.tmuxSessionLabels` is a deliberate creative-label exception: these are themed suggestions for new tmux sessions, not a one-to-one translation list. Locales may curate their own theme, and an explicitly shared themed set is acceptable, but every locale must preserve the array length. This exception does not permit copying sibling-locale prose or mechanically converting ordinary translations.

### CRITICAL — zh-TW must never contain Mainland Chinese terminology

`zh-TW.json` targets Traditional Chinese users in **Taiwan**. It must use Taiwan computing terminology — never Mainland Chinese terms, even when the characters are traditional. This is a hard review gate: any zh-TW string that uses a Mainland term is a bug that blocks the translation pass. See `docs/manual/16-localization.md` for the full forbidden→required term mapping table. Common examples: 連線 (not 連接 for "connection"), 終端機 (not 終端), 視窗 (not 窗口), 儲存 (not 保存), 預設 (not 默認), 資料 (not 數據), 資訊 (not 信息), 軟體 (not 軟件), 網路 (not 網絡), 滑鼠 (not 鼠標), 存取 (not 訪問), 記憶體 (not 內存), 伺服器 (not 服務器), 客戶端 (not 用戶端), 遠端 (not 遠程), 使用者 (not 用戶), 程式 (not 程序), 螢幕 (not 屏幕), 選單 (not 菜單), 搜尋 (not 搜索), 說明 (not 幫助), 萬用字元 (not 通配符), 回送 (not 回環), 介面 (not 接口), 資料夾 (not 文件夾), 檔案總管 (not 文件資源管理器), 載入 (not 加載), 套件 (not 軟件包). When in doubt, consult an established Taiwan computing glossary — never copy from `zh-CN.json` and convert characters.
4. Run `pnpm run i18n:check` and fix any missing, redundant, or misordered keys before finishing the translation run.
5. **Delete** the matching `docs/localization_todo/<namespace>.<keyPath>.md` file.

When you rename or remove a key:

1. Update `en.json` and every non-English locale that touched the key.
2. Run `pnpm run i18n:check` and fix any missing, redundant, or misordered keys.
3. Rename or delete the matching `docs/localization_todo/*.md` file to match.

## Why per-file

The previous single-file backlog generated merge conflicts on every feature branch that touched UI strings. Per-key files let independent branches add, remove, and translate entries without touching shared lines.

## Template

See [`_TEMPLATE.md`](_TEMPLATE.md). Do not edit `_TEMPLATE.md` for a real string — copy it first.

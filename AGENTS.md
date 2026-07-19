# Agent Instructions

## Project Shape

KKTerm is a cross-platform, local-first Tauri v2 desktop app: Rust backend,
React/TypeScript frontend, SQLite for non-secret durable data, and OS keychain
for secrets.

Use these docs as the source of truth instead of copying their rules here:

- `CONTEXT.md` — product vocabulary and domain boundaries.
- `docs/ARCHITECTURE.md` — architecture, source map, command boundaries,
  native-window rules, Settings rules, overlays, i18n, and UI placement.
- `docs/PRD.md` / `docs/ROADMAP.md` — product scope and direction.
- `docs/DASHBOARD.md` / `docs/ITOPS.md` — Dashboard and IT Ops Module deep
  dives; each wins over `docs/ARCHITECTURE.md` on its Module-internal concerns.
- `docs/ADR/` — accepted architectural decisions.
- `docs/manual/INDEX.md` — shipped operation manual and chapter index.

Before changing behavior, terminology, or source placement, read the relevant
source-of-truth docs and preserve their boundaries.

## Constitution

These rules apply to every task unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

## Rule 1 — Think Before Coding

State assumptions explicitly. If uncertain, ask rather than guess.
Present multiple interpretations when ambiguity exists.
Push back when a simpler approach exists.
Stop when confused. Name what's unclear.

## Rule 2 — Simplicity First

Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
Test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Rule 3 — Surgical Changes

Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting.
Don't refactor what isn't broken. Match existing style.
`cargo fmt` is optional in this repo. Rust formatting must use the Rust 2024
edition, as configured by `rustfmt.toml`. If formatting is useful, run it only
on the smallest practical Rust scope you intentionally touched, such as a
single file or single Rust source file. Do not run broad `cargo fmt` over the
whole workspace unless the user explicitly asks for global formatting; it can
rewrite unrelated Rust sources and create noisy file-format churn.

## Rule 4 — Goal-Driven Execution

Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate.
Strong success criteria let you loop independently.

## Working Rules

- Domain language lives in `CONTEXT.md`. Use **Connection** for durable openable
  resources, **Session** for live runtime state, and **Tab** for the frontend
  workspace container. Do not say "profile" for a stored Connection.
- Capital-M **Module** means a top-level Activity Rail destination. Current
  product Modules are **Workspace**, **Dashboard**, **Install Helper**,
  **Screenshots**, and **IT Ops**; **Settings** is the bottom rail destination. The App Launcher is a Dashboard widget, not a Module.
- Source placement lives in `docs/ARCHITECTURE.md` → "Frontend Source Map".
  Prefer existing source areas and typed wrappers in `src/lib/tauri.ts`.
- SQLite schema changes must preserve the current-version startup fast path
  documented in `docs/ARCHITECTURE.md` → "Schema initialization and
  migrations". Update `CURRENT_SCHEMA`, bump `SCHEMA_USER_VERSION`, and put the
  version-gated upgrade below the fast-path return. For every schema or durable
  seed change, explicitly audit whether current-version startup needs ongoing
  reconciliation; if it does, update both the fast path and the post-migration
  seed tail (or their shared helper), keep unchanged reconciliation write-free,
  and add upgrade plus current-reopen regression coverage.
- The operation manual ships with the app. Any UI behavior change in a manual
  chapter's scope must update the relevant chapter in `docs/manual/`; reference
  i18n keys, not English labels.
- Tutorial-capable UI needs a stable `data-tutorial-id`, a navigation entry in
  `src/app/tutorialNavigationModel.ts`, matching `tutorial_highlight` metadata
  in `src-tauri/src/ai.rs`, and manual grep hints. `npm run check` validates
  these mappings.
- All user-visible strings go through i18n. Add English keys first in
  `src/i18n/locales/en.json`; whenever new UI strings are created or changed,
  follow `docs/localization_todo/README.md` exactly. Add one pending file per
  key under `docs/localization_todo/` in the same change, even if an AI session
  adds best-effort translations to the non-English locale files. Delete that
  file only after an intentional, verified localization pass completes every
  supported locale using the README's flow and template. When the
  meaning of an English word shifts by context (e.g. "Play" starts media, runs
  something, or names a theatrical play — each translates differently), create a
  separate key per context instead of reusing one; reuse a key only when the
  meaning is identical everywhere. Keep interpolation placeholders
  translation-safe: use named `{{…}}` placeholders, one full sentence per key,
  no concatenated fragments around a variable. See
  `docs/manual/16-localization.md` and `docs/ARCHITECTURE.md`.
- **zh-TW must never contain Mainland Chinese terminology.** This is a critical
  review gate. `zh-TW.json` uses Taiwan computing terminology — never Mainland
  terms, even in traditional characters. See the forbidden→required term mapping
  in `docs/manual/16-localization.md` (e.g. 連線 not 連接, 終端機 not 終端,
  儲存 not 保存, 預設 not 默認, 資料 not 數據, 伺服器 not 服務器, 客戶端 not
  用戶端, 使用者 not 用戶, 程式 not 程序, 螢幕 not 屏幕, 萬用字元 not 通配符,
  介面 not 接口). Never copy from `zh-CN.json` and convert characters.
- The UI design language (tokens, dialog primitives, the `ConfirmSheet`
  confirmation template, button order, and the SFTP file-browser pattern) lives
  in `docs/DESIGN_LANGUAGE.md`. Read it before adding any dialog, sheet, settings
  surface, or file-browser UI. Build dialogs from `src/app/ui/dialog` primitives
  and read color tokens from `src/styles/colorSchemes.css`; never hard-code hex.
- App-owned popup dialogs use a single concise title by default. Do not add a
  subtitle or explanatory header copy unless the flow truly needs it; put
  supporting text in the dialog body near the relevant controls instead.
- Dialog footers follow the host platform: macOS ends with Cancel then the
  primary/confirm action; Windows and Linux end with the primary/confirm action
  then Cancel. Auxiliary actions stay left of the bottom-right action group.
  Build the order with shared `Actions` or `LegacyDialogActions`; do not rely on
  per-dialog source order or CSS reversal.
- App-owned popup dialogs must not show a title-bar close X when the footer
  already has a bottom-right dismiss action such as Cancel, Skip, Later, or
  Close. Keep one obvious dismiss path instead of duplicating the same action.
- App-owned popup dialogs that do not have a footer dismiss action may keep a
  title-bar close X, but it must use the shared `connection-dialog-close` (or
  `mcp-dialog-close-button` where already established) header placement so the
  control is anchored to the dialog's top right, independent of title text flow.
  Pad header/content so titles and actions cannot overlap the close control.
- Built-in MCP tool changes must update `docs/MCP.md`; if Settings AI
  behavior/safety text changes, also update `docs/manual/15-settings.md`.

## High-Risk Invariants

- Do not add frontend close hooks or close-confirmation flows. The only allowed
  close-path diversion is the native Rust minimize-to-tray handler documented in
  `docs/ARCHITECTURE.md`.
- Automatic database backups must not run from app-window close; use startup or
  explicit Settings backup flows.
- Do not put live Session state into the durable Connection model.
- `withLiveConnectionStatuses` is display-only. Do not pass its fresh
  Connection objects to workspace components that own Session lifecycles.
- Every user-facing transient notification—information, success confirmation,
  warning, or error—belongs in the bottom Status Bar popup via
  `showStatusBarNotice` with the matching `tone`. Do not render transient
  outcome text inline in dialogs/pages and do not add one-off toast, banner, or
  status implementations. Use `showStatusBarProgress` for determinate work.
- Golden rule: transient popups float above every dialog backdrop, always. The
  Status Bar notice popup must mount through the app-window `DialogPortal`
  (`document.body`) so it escapes the `.status-bar` stacking context; a high
  `z-index` alone cannot lift an overlay out of a positioned ancestor's
  stacking context. Do not move it back inline. See the overlay golden rule in
  `docs/ARCHITECTURE.md`; `tests/dialog-portal-policy.test.mjs` guards the
  portal and z-order.
- Do not use `window.alert`, `window.confirm`, or `window.prompt`; use
  translated app-owned dialogs/popovers.
- RDP ActiveX overlay parking is RDP-only. Do not extend that workaround to
  WebView2, terminal, SFTP/FTP, or VNC surfaces without documenting and proving
  a separate runtime failure.
- To re-apply RDP display size while the session must stay visible, use
  `update_rdp_bounds` (pass `force: true` to bypass the unchanged-size gate),
  never `sync_rdp_display_size`. `sync_rdp_display_size`/`stage_rdp` park the
  ActiveX HWND off-screen and only work when immediately followed by a
  `set_rdp_visibility` reveal; using them on their own blanks a "Connected"
  pane. See the RDP command lifecycle note in `docs/ARCHITECTURE.md`.
- Simple command menus in Workspace use Tauri native context menus through
  `src/lib/nativeContextMenu.ts`; do not replace them with DOM menus unless the
  menu needs forms or custom interactive content.
- CSS `z-index` cannot raise React UI above a URL Connection `WebviewWindow` or
  the Windows RDP ActiveX HWND. Any right-click menu that can intersect either
  native surface must use `src/lib/nativeContextMenu.ts`, including menus in
  split Panes and Dashboard Connection widgets. If a menu truly needs forms,
  sliders, live previews, or other custom interaction, keep it as DOM UI and
  register its narrow visible selector in
  `src/modules/workspace/nativeOverlay.ts` instead of relying on placement.
- Any app-owned dialog, popover, drag preview, or other DOM overlay that may
  intersect a URL or RDP native surface must participate in the shared
  intersection registry in `src/modules/workspace/nativeOverlay.ts`. URL
  Connections use snapshot-then-hide; RDP uses snapshot-then-park for its
  ActiveX HWND only. Do not bypass the URL snapshot by merely setting the
  WebView inactive, and never reuse the RDP parking commands for URL WebView2.
  Full-window dialogs must also portal to `document.body` through the shared
  dialog primitives. Extend `tests/native-surface-overlay-policy.test.mjs` when
  adding a qualifying menu or overlay.
- Validate local Windows terminal focus/input, WebView2, RDP/VNC, keychain,
  native menus, title-bar close, and OS integration in the real Tauri desktop
  runtime, not standalone Vite/browser preview.

## Checks

The full check suite is optional. Run it before handing work back only after a
significant code change, defined as more than 500 changed lines of code. Do not
run the full suite for cosmetic UI changes or documentation-only updates.

```bash
npm run check
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run check` runs ESLint (`npm run lint`), then the auto-discovered frontend
test suite (`tests/run-all.mjs` picks up every `tests/*.test.{mjs,ts}` except a
documented `QUARANTINE` set), then `tsc --noEmit`. Add a new frontend test by
dropping a file in `tests/`; do not maintain a hand-edited test list. CI runs
the same checks, including `cargo test`.

If a required check cannot be run, explain why in the final response.

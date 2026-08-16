# Contributing to KKTerm

Thanks for even reading this file. It already puts you in the top decile of internet users.

KKTerm is a cross-platform, local-first admin workspace built with **Tauri v2 + Rust + React 19**. We welcome contributions of every size — translations, bug repros, doc fixes, dashboard widgets, AI adapters, full features. This document explains how to set up, where things live, what we expect in a PR, and the handful of rules that are non-negotiable because we have already learned them the hard way.

If you have not yet read [`CONTEXT.md`](CONTEXT.md) and [`AGENTS.md`](AGENTS.md), please skim them first. They are short and they are the canonical source for product terminology and engineering rules. This document is a more contributor-focused gloss on top of them.

---

## Contributing with an AI Agent

**The fastest way to contribute is to let your AI agent do the heavy lifting.** Point your agent at the project's AI instructions and it will orient itself — conventions, module boundaries, i18n rules, hard rules, all of it — before touching a single file.

Just tell your agent:

> Read the instructions at https://github.com/ryantsai/KKTerm/blob/main/docs/AIINSTRUCTIONS.md before making any changes to this project.

That document is the single authoritative brief written for AI contributors. It covers everything an agent needs to contribute correctly without a round-trip to the maintainer.

---

## Table of Contents

- [Contributing with an AI Agent](#contributing-with-an-ai-agent)
- [Quick Ways to Help](#quick-ways-to-help)
- [Development Setup](#development-setup)
- [Project Layout](#project-layout)
- [Domain Language (Please Read This Once)](#domain-language-please-read-this-once)
- [Branches, Commits, and PRs](#branches-commits-and-prs)
- [Required Checks Before You Open a PR](#required-checks-before-you-open-a-pr)
- [Coding Conventions](#coding-conventions)
- [Internationalization (i18n)](#internationalization-i18n)
- [Hard Rules — Please Do Not Break These](#hard-rules--please-do-not-break-these)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Security](#security)
- [Code of Conduct](#code-of-conduct)
- [License](#license)

---

## Quick Ways to Help

Pick whichever matches the time you have:

| Time you have | Things you can do |
| --- | --- |
| **5 minutes** | Star the repo, file a "this felt off" issue with a screenshot, fix a typo in [`docs/manual/`](docs/manual/) |
| **30 minutes** | Translate one pending i18n key from [`docs/localization_todo/`](docs/localization_todo/), write a manual chapter section for a feature you actually used |
| **A weekend** | Add a built-in Dashboard widget, tighten an AI provider adapter, fix a `good first issue` |
| **A whole feature** | Open an issue first so we can scope it together — KKTerm has strong opinions about module boundaries and we want to save you from a 1,000-line revert |

Looking for an entry point:

- [`good first issue`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
- [`help wanted`](https://github.com/ryantsai/KKTerm/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22)

If the queues are empty, that just means you get to define the problem. Open an issue describing what you want to work on.

---

## Development Setup

### Prerequisites

- **Windows 10/11, macOS, or Linux**
- **Node.js** (LTS) and **npm**
- **Rust toolchain** (`rustup` recommended)
- **Tauri v2 prerequisites for Windows** — most importantly **WebView2 Runtime** (preinstalled on modern Windows; otherwise grab it from Microsoft)
- **Visual Studio Build Tools** with the Desktop C++ workload (required by Rust on Windows)

### First run

```bash
git clone https://github.com/ryantsai/KKTerm.git
cd KKTerm
npm install
npm run tauri dev
```

The first build of the Rust side will take several minutes — it is compiling `russh`, `vnc-rs`, `suppaftp`, and a handful of other crates from source. Subsequent builds are incremental and fast.

If `npm run tauri dev` produces a native window: you're set. If it produces a stack trace: copy it into an issue and tag it `setup`, we'll dig.

### Running the real native build

A Vite browser preview (`npm run dev`) is fine for some frontend inspection, but **it is not a valid validation surface** for KKTerm. The native window is the only place that can host ConPTY, WebView2, the RDP ActiveX control, the VNC framebuffer, the Windows keychain, native menus, and the tray. Always validate native-touching changes with `npm run tauri dev` or the `Run KKTerm exe` VS Code launch config.

### VS Code launch configs

- **`Run KKTerm exe`** — starts `src-tauri/target/debug/kkterm.exe` with `RUST_BACKTRACE=1`, lets you set Rust breakpoints.
- **`Attach KKTerm WebView2`** — attaches DevTools to the real WebView2 host so you can inspect frontend state inside the desktop runtime, not a browser.

---

## Project Layout

The directories you will most likely touch:

```
KKTerm/
├── src/                     # React 19 + TypeScript frontend
│   ├── App.tsx              # App shell ONLY (routing, chrome composition)
│   ├── app/                 # Activity Rail, RailTooltip, workspace chrome
│   ├── modules/             # Top-level Modules (see docs/ARCHITECTURE.md)
│   │   ├── workspace/       # Tab dispatch, StatusBar, screenshots, native overlay
│   │   │   └── connections/ # Connection tree + dialogs
│   │   │       ├── terminal/       # TerminalWorkspace (local / SSH / Telnet / Serial)
│   │   │       ├── sftp/           # SFTP / FTP dual-pane browser
│   │   │       ├── webview/        # WebView2 URL workspace
│   │   │       └── remote-desktop/ # RDP (ActiveX) + VNC workspace
│   │   ├── dashboard/       # Dashboard Module, grid
│   │   │   └── widgets/     # Built-in widgets — drop new ones here
│   │   ├── installer/       # Install Helper Module
│   │   └── settings/        # SettingsPage and section files
│   ├── ai/                  # AssistantPanel, chat, tool dispatch
│   │   └── providerRegistry/ # Frontend provider/model metadata
│   ├── i18n/
│   │   ├── config.ts        # i18next setup, switchLanguage, ensureI18nReady
│   │   ├── useT.ts          # Typed t() hook
│   │   └── locales/         # en.json (source of truth) + 13 others
│   └── lib/
│       ├── tauri.ts                 # Typed wrappers for invoke()
│       ├── nativeContextMenu.ts     # Native Tauri menus + icon rasterization
│       └── settings.ts              # useBootstrapSettings, secret owner const
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── lib.rs           # Tauri builder, command registration, window events
│   │   ├── ai/providers/    # Rust adapters for OpenAI-compatible providers
│   │   └── ...              # Connection, session, sftp, rdp, vnc, etc.
│   └── Cargo.toml
├── docs/
│   ├── ARCHITECTURE.md      # Frontend module map — READ BEFORE PLACING NEW UI
│   ├── ROADMAP.md
│   ├── DASHBOARD.md
│   ├── AI_PROVIDERS.md
│   ├── PERFORMANCE.md
│   ├── RELEASE.md
│   ├── manual/              # End-user manual shipped with the app
│   └── localization_todo/   # One file per pending i18n key
├── scripts/                 # PowerShell build / release / smoke scripts
├── AGENTS.md                # Constitution + engineering defaults
├── CONTEXT.md               # Product terminology (Connection / Session / Tab)
└── CLAUDE.md                # Pointer file for AI assistants
```

`docs/ARCHITECTURE.md` contains the authoritative "where does this code go" map. When in doubt, read it before creating a new top-level folder.

---

## Domain Language (Please Read This Once)

KKTerm has precise nouns. Using them correctly in code, commits, PR descriptions, UI strings, and docs is the single highest-signal thing you can do to make a PR easy to review.

- **Connection** — durable saved resource in SQLite. Kinds: local terminal, SSH terminal, Telnet, Serial, URL (WebView2), RDP, VNC, FTP/FTPS, File Explorer (`localFiles`). SFTP opens from an SSH Connection and is not a standalone saved kind.
- **Quick Connect** — unsaved one-off draft that starts a Session.
- **Session** — live runtime state: PTY, SSH channel, SFTP browser, WebView2 host, RDP control, VNC framebuffer.
- **Tab** — frontend workspace container; not a backend object. Closing a Tab ends its Session. Switching Tabs does **not**.
- **Pane** — a subdivision of a Tab presenting one terminal surface or view.

Words we have decided not to use because they cause confusion: **profile**, **saved session**, **host entry**, **temporary profile**, **session tab**, **browser tab**, **screen profile**.

Full glossary with examples: [`CONTEXT.md`](CONTEXT.md).

---

## Branches, Commits, and PRs

- **Branch from `main`.** Use a descriptive name: `feat/dashboard-disk-widget`, `fix/sftp-recursive-upload-progress`, `i18n/zh-tw-ai-tools`.
- **One logical change per PR.** Smaller PRs get reviewed faster. If your PR description starts with "Also, while I was in there…" — please split it.
- **PR title:** imperative mood, present tense, no trailing period. `Add CPU usage dashboard widget`, not `Added a new widget for CPU.`
- **PR description must include:**
  - **What** changed in one sentence.
  - **Why** — link the issue, or describe the problem.
  - **How to verify** — exact steps a reviewer can run.
  - **Screenshots / short clips** for any visible UI change. We mean it. "Trust me it looks fine" gets bounced.
  - **i18n note** if you added or changed English strings (see below).
- **Keep formatting changes out of feature PRs.** `cargo fmt` is *optional* in this repo; if you do run it, run it only on files you intentionally touched, never the whole workspace.

---

## Required Checks Before You Open a PR

Run all four. They are not optional.

```bash
npm run check                                              # ESLint + frontend tests + tsc
npm run build                                              # Vite production build
cargo check --manifest-path src-tauri/Cargo.toml           # Rust compiles
cargo test  --manifest-path src-tauri/Cargo.toml           # Rust tests pass
```

`npm run check` runs, in order: `npm run lint` (ESLint flat config — correctness rules such as `react-hooks/rules-of-hooks` are errors, pre-existing stylistic findings are warnings), the frontend test suite, then `tsc --noEmit`. Both CI jobs run the same checks (`cargo test` included).

Frontend tests live in `tests/` and are **auto-discovered** by `tests/run-all.mjs` — drop in a `*.test.mjs` (plain Node) or `*.test.ts` (run through the `tsx` loader, for behavioral tests against pure modules) and it runs automatically; there is no list to edit. A short, documented `QUARANTINE` set in the runner holds pre-existing source-grep guards whose asserted source text has drifted; prefer fixing or replacing those with behavioral tests over adding to it.

If a check cannot be run in your environment, say so explicitly in the PR description rather than skipping it silently.

For UI-touching changes, additionally smoke-test in the real native runtime:

```bash
npm run tauri dev
```

…and exercise the feature in the actual window. The browser preview is not a substitute.

---

## Coding Conventions

### TypeScript / React

- **Functional components + hooks.** No class components.
- **State**: Zustand for shared app state, local `useState` for ephemeral UI state. Do not put live Session state into the durable Connection model.
- **Styling**: Tailwind utility classes for layout; CSS variables for theme tokens; prefer `className` and `data-*` attributes over inline `style=` when classes can carry the state.
- **No browser-native popups.** Never use `window.alert`, `window.confirm`, or `window.prompt` — they render with localhost labels inside Tauri. Build app-owned dialogs with translated strings instead.
- **Tauri calls go through typed wrappers** in [`src/lib/tauri.ts`](src/lib/tauri.ts). Do not call `invoke()` directly from feature components.
- **Native context menus** go through [`src/lib/nativeContextMenu.ts`](src/lib/nativeContextMenu.ts), not DOM replacements.

### Rust

- Match the existing pattern in each module. Most subsystems already have a shape — copy it.
- Keep destructive operations behind explicit user-facing confirmation paths.
- AI provider adapters live in `src-tauri/src/ai/providers/`; add new ones alongside the existing files and register them in the frontend `providerRegistry/`.

### Comments

Default to writing none. Add one only when the **why** is non-obvious — a hidden constraint, a workaround, a subtle invariant. Don't restate what the code already says. Don't reference issue numbers in comments; that belongs in the PR description.

---

## Internationalization (i18n)

This is the area where new contributors most commonly slip. Three rules and you'll be fine:

1. **Every user-visible string must go through `t()`.** Labels, aria-labels, titles, placeholders, status messages, error messages. Bare English text in JSX is a bug.
2. **Implement English first.** Add the key to `src/i18n/locales/en.json` in the right namespace (`app`, `settings`, `connections`, `terminal`, `sftp`, `webview`, `remoteDesktop`, `ai`, `workspace`, `common`, `languages`).
3. **Track pending translations** by copying [`docs/localization_todo/_TEMPLATE.md`](docs/localization_todo/_TEMPLATE.md) to `docs/localization_todo/<namespace>.<keyPath>.md` (one file per key, never bundled). Fill in every field; the per-file layout exists so feature branches do not merge-conflict on a shared backlog.

When you actually translate the key into another locale, delete the matching `localization_todo` file. If you rename or remove a key, rename or remove the todo file too.

Always run `npm run i18n:check` during translation runs. It compares `src/i18n/locales/en.json` to every other locale file and reports missing or redundant keys before review.

Technical terms (SSH, SFTP, RDP, VNC, tmux, ProxyJump, PowerShell, WSL, API, URL) typically stay English across all locales.

---

## Hard Rules — Please Do Not Break These

These are bug categories we have already shipped and reverted at least once. We will be politely insistent in review.

- **No frontend close hooks.** `onCloseRequested`, `tauri://close-requested`, JS-side close listeners, and close-confirmation dialogs have repeatedly broken the native Windows title-bar close button in Tauri v2. The only allowed close-path code is the existing synchronous Rust-side `WindowEvent::CloseRequested` arm in `lib.rs` for minimize-to-tray. Do not add new ones.
- **Do not put live Session state into the durable Connection model.** Keep UI state in the workspace layer.
- **Do not hand a live-status-augmented `Connection` to a feature workspace** (`TerminalWorkspace`, `SftpWorkspace`, `WebViewWorkspace`, `RemoteDesktopWorkspace`). `withLiveConnectionStatuses` returns a fresh reference on every status change, which will tear down and restart the Session in an infinite mount/unmount loop. Look the Connection up by `id` from the raw tree instead. See [`src/modules/dashboard/widgets/ConnectionWidgetBody.tsx`](src/modules/dashboard/widgets/ConnectionWidgetBody.tsx) for the correct pattern.
- **Overlay parking is RDP-only.** The screenshot-and-park workaround for the RDP ActiveX HWND lives in [`src/modules/workspace/nativeOverlay.ts`](src/modules/workspace/nativeOverlay.ts) and must not be applied to WebView2, terminal, SFTP, or VNC workspaces.
- **Activity rail tooltips** use the shared `RailTooltip` in [`src/app/RailTooltip.tsx`](src/app/RailTooltip.tsx), not native `title` attributes.
- **Transient status messages** use `showStatusBarNotice` and render through [`src/modules/workspace/StatusBar.tsx`](src/modules/workspace/StatusBar.tsx). Do not add one-off toast implementations.
- **No automatic database backups on app-window close.** Backups run at startup or on explicit manual trigger, using the importable KKTerm settings ZIP format.
- **No `cargo fmt` over the whole workspace** unless explicitly requested. Limit it to files you intentionally touched.

The full list lives in [`AGENTS.md`](AGENTS.md) under "Engineering Defaults." Reviewers will reference rules by name; reading that section once will save you a round trip.

---

## Reporting Bugs

Good bug reports include:

- KKTerm version (Settings → About).
- Windows version.
- Steps to reproduce — concrete, ordered, ideally starting from a fresh launch.
- What you expected.
- What actually happened.
- A screenshot, short screen capture, or terminal output for the failing part.
- Whether the bug reproduces in the latest `main` from `npm run tauri dev`.

"It felt off" is a legitimate report — just say so, and we'll investigate together. Imprecision is fine; vagueness about reproducing isn't.

---

## Suggesting Features

For anything bigger than a small polish, **open an issue first.** KKTerm has strong opinions about module boundaries and the no-telemetry / local-first posture, and we'd rather discuss shape before you write 600 lines. A short proposal with the use case and a rough sketch of the UI is plenty.

Things that are explicitly out of scope today:

- Cloud sync / team accounts / SaaS tier.
- Mobile viewport layouts. KKTerm is desktop-only by design.
- Browser-native popups (`alert`/`confirm`/`prompt`).
- Frontend close-confirmation flows.
- Unattended autonomous AI execution. The assistant must remain proposal-and-approval shaped.

---

## Security

If you find a security vulnerability — credential handling, command-injection in proposed commands, sandbox escape from a script widget — **please do not open a public issue.** Email the maintainer at the address in the repo profile, or use GitHub's "Report a vulnerability" private advisory flow.

For non-sensitive security improvements (e.g. "this parser could be stricter"), a normal issue or PR is fine.

---

## Code of Conduct

Be civil. Assume good faith. Reviews are about the code, not the contributor. Maintainers reserve the right to close issues or PRs that are abusive, off-topic, or attempting to brigade the project.

If a discussion gets heated, step away for an hour. That advice applies to the maintainers too.

---

## License

By contributing, you agree your contributions are licensed under the project's [LICENSE](LICENSE) (MIT with Commons Clause). No CLA, no copyright assignment — your name stays on your commits.

---

Thank you. Genuinely. Every PR makes the project a little less of a one-person hobby and a little more of a thing that survives the maintainer getting a cold.

# 18 — Installer Helper

## AI grep hints

- Keys: `installer.title`, `installer.subtitle`, `installer.railLabel`, `installer.refresh`, `installer.checkUpdates`, `installer.updateAll`, `installer.section.installed`, `installer.section.available`, `installer.section.updates`, `installer.actions.install`, `installer.actions.update`, `installer.actions.uninstall`, `installer.actions.cancel`, `installer.options.scope`, `installer.options.version`, `installer.options.location`, `installer.options.addToPath`, `installer.options.pinVersion`, `installer.status.installing`, `installer.status.uninstalling`, `installer.status.completed`, `installer.status.failed`, `installer.status.cancelled`, `installer.status.partial`, `installer.status.scanning`, `installer.empty.loading`, `installer.confirm.installTitle`, `installer.confirm.installWithPrereqsBody`, `installer.confirm.uacFooter`, `installer.confirm.uninstallTitle`, `installer.confirm.uninstallSimpleBody`, `installer.confirm.uninstallDependentsBody`, `installer.confirm.uninstallDependentsFooter`, `installer.confirm.updateAllTitle`, `installer.confirm.updateAllBody`, `installer.confirm.updateAllConfirm`, `installer.wslReboot`
- Topics: Installer Helper Module, bundled catalog (compile-time embedded), ADR 0008 supersedes ADR 0007, winget recipes, npm recipes, github-release recipes, Windows feature recipes (DISM), bundles (node-bundle, python-bundle), dependency resolution, UAC prompts, WSL reboot gating, pin version, in-flight cancellation, tutorial targets `app.activityRailInstaller`, `installer.updateAll`, `installer.toolOptions`
- Synonyms: "install nvm", "install Node", "install Python", "install Docker", "install Claude Code", "set up dev tools", "developer tools installer", "package manager"

## What it is

The **Installer Helper Module** is a built-in Activity Rail destination that installs, updates, and uninstalls a curated catalog of Windows developer tools — git, node, python, docker, AI coding CLIs, and so on. It is grouped with the other built-in Module buttons near the top of the rail, with its own icon (`Package`).

The catalog **ships with the KKTerm release**: the JSON list of supported tools is compiled into the binary at build time. Updates to the catalog ride with each release. See `docs/ADR/0008-installer-helper-bundled-catalog.md` for the rationale and what it supersedes.

## Module layout

The page has a header and three sections:

- **Header.** Title (`installer.title`), subtitle (`installer.subtitle`), and three buttons:
  - `installer.refresh` — re-runs detection for every catalog tool.
  - `installer.checkUpdates` — queries the latest available version for every installed tool and caches the result.
  - `installer.updateAll` — installs every available update sequentially. Tutorial target: `installer.updateAll`.
- **Updates available** (`installer.section.updates`) — installed tools whose cached latest version differs from the detected installed version.
- **Installed** (`installer.section.installed`) — tools currently present on the system.
- **Available** (`installer.section.available`) — catalog tools not currently installed.

Each tool row collapses by default and expands on click. The expanded body shows the description, the options form (only the options the recipe declares apply), an inline progress panel with the current step and a tail of the log, and the action buttons. Tutorial target: `installer.toolOptions`.

## Tool detection

Detection runs once on the first Module entry per app session and is held in memory until the user clicks `installer.refresh` or quits the app. It is **never persisted across restarts** — re-running detection is the canonical truth about what is installed.

Per-provider detection methods:

- **winget** — `winget list --id <id> --exact --source winget --disable-interactivity`. Exit 0 = installed; the version is parsed from the data row.
- **npm** — `npm ls -g --json --depth=0`. Looks up the package in the top-level `dependencies`.
- **github-release** — a marker file at `%LOCALAPPDATA%\KKTerm\installer\bin\<tool_id>\.kkterm-installer.json` written at install time. Only installs we performed count as "managed".
- **windows-feature** — `dism /online /get-featureinfo /featurename:<X>`. Parses the `State :` line.
- **bundle** — installed iff every step's detection is installed; otherwise the row shows `installer.status.partial` with an `installed/total` count.

## Install flow

1. The user clicks `installer.actions.install` on a row.
2. The frontend resolves the install plan: transitive `needs` are walked, and prerequisites already detected as installed are skipped.
3. If the plan has unresolved prerequisites OR a non-zero UAC-prompt estimate, a confirm dialog (`installer.confirm.installTitle`) lists the prerequisites and a footer (`installer.confirm.uacFooter`) names the estimated prompt count.
4. On confirm, the backend dispatches the install in a worker thread. Progress streams to the frontend on the `installer://progress` Tauri event channel as a discriminated union: `step`, `stdout`, `stderr`, `progress`, `completed`, `failed`, `cancelled`.
5. After a `completed` event, the row re-runs detection automatically and moves to the Installed section.

## Update flow

1. The user clicks `installer.checkUpdates` (header).
2. The backend calls each installed tool's latest-version query (`winget show`, `npm view <pkg> version`, GitHub releases API for `githubRelease`). Results are persisted in the `installer_tool_state` SQLite table.
3. Rows whose `latestVersionSeen ≠ installedVersion` move to the Updates section and show their per-row `installer.actions.update` button.
4. Clicking `installer.updateAll` lists every pending update in a dialog (`installer.confirm.updateAllTitle`), warns about the likely UAC prompt count, and on confirm runs the queue sequentially. Pinned tools (see Pin version below) are skipped.

A real-time background check is opt-in only — not in v1.

## Uninstall flow

1. The user clicks `installer.actions.uninstall` on an installed row.
2. The frontend runs a reverse-dependency check: every catalog recipe whose `needs` includes this row's id AND whose detection says installed is collected.
3. If dependents exist, the confirm dialog (`installer.confirm.uninstallTitle`) lists them with the warning `installer.confirm.uninstallDependentsBody` and the footer `installer.confirm.uninstallDependentsFooter`. Otherwise the dialog shows the simple body `installer.confirm.uninstallSimpleBody`.
4. On confirm, the backend dispatches per-provider uninstall: `winget uninstall`, `npm uninstall -g`, `Remove-Item -Recurse` on the github-release install directory, `dism /online /disable-feature`.

There is intentionally no "Uninstall all" action.

## Cancellation

Per row, an in-flight install/uninstall surfaces an `installer.actions.cancel` button. Cancel raises an `AtomicBool` flag the worker thread polls; on the next check it kills the child process and emits `cancelled`. Partial installs are **not rolled back** — the underlying installer's transactionality is what it is.

For "Update all", cancel stops the **queue** (the next-up tools), not the in-flight install.

## Options

Each recipe declares a subset of these options (the set is closed):

- **`installer.options.scope`** — `user` (default) vs `machine`. Winget recipes only. Machine-scope always triggers UAC.
- **`installer.options.version`** — specific version string, or empty = `installer.options.versionLatest`.
- **`installer.options.location`** — install location override. Winget: `--location`. github-release: extraction directory.
- **`installer.options.addToPath`** — github-release recipes only. Appends the install directory to user PATH via PowerShell after extraction.
- **`installer.options.pinVersion`** — row-level checkbox. When checked, this tool is **excluded** from `installer.updateAll`. Pinning does not prevent a per-row update click.

## WSL reboot gating

When the user installs the WSL Windows feature in the current app session, the Installer Helper sets a session-only flag `wslJustEnabled`. While that flag is set, any recipe that transitively `needs` WSL (Docker Desktop in the v1 catalog) shows the hint `installer.wslReboot` and its install button is disabled. The flag resets only when KKTerm is restarted — which is what happens during a real Windows reboot.

## Persistence

- **SQLite** — table `installer_tool_state(tool_id PK, pinned, latest_version_seen, last_check_at)` (schema version 17). Pinning and the cached latest version survive restarts.
- **In-memory only** — current detected state, the in-flight install queue, the WSL reboot flag, the per-tool log buffer.
- **On-disk install dirs** — `%LOCALAPPDATA%\KKTerm\installer\bin\<tool_id>\` holds installed `githubRelease`-provider tools and their `.kkterm-installer.json` marker file. These are installed-tool state, not catalog cache.

## Catalog source

The catalog `installer/catalog.v1.json` is **embedded into the KKTerm binary at compile time** via `include_str!`. Updates to the catalog ship with the next KKTerm release — there is no network fetch, no on-disk cache, and no signature verification. The trust anchor is the app binary itself (eventually backed by Windows code-signing of the KKTerm installer).

Adding, editing, or removing a tool is a normal commit to `installer/catalog.v1.json` followed by a release. The `shipped_catalog_parses_and_validates` test embeds the same JSON via `include_str!` and runs `Catalog::validate()`, so malformed edits fail `cargo test` before they can ship.

See [`docs/ADR/0008-installer-helper-bundled-catalog.md`](../ADR/0008-installer-helper-bundled-catalog.md) for the design rationale and what it supersedes from [ADR 0007](../ADR/0007-installer-helper-remote-catalog.md).

## Tutorial

The Module is tutorial-capable in v1 via two targets:

- `app.activityRailInstaller` — the rail button (navigation: workspace).
- `installer.updateAll` — the header button (navigation: installer).
- `installer.toolOptions` — the per-row options form (navigation: installer).

## Limits

- AI Assistant integration is deferred. The AI does **not** have a Tauri command to trigger installs in v1.
- "Latest version" detection for `bundle` and `windowsFeature` recipes returns null — the rows do not surface update suggestions.
- The UAC prompt count shown in confirm dialogs is a best-effort estimate; some installers (Docker Desktop, system MSIs) self-escalate even when `--scope user` is passed.

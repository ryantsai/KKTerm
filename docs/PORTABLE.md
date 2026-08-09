# Portable Mode Plan

Status: **Implemented and verified** (Windows portable v1, 2026-07-19).

This document defines the portable distribution of KKTerm: a ZIP the user unpacks
to a writable local folder or removable drive that runs without an installer,
keeps KKTerm-owned durable state next to the executable, and can coexist with a
normally installed KKTerm on the same machine.

"Portable" is a storage and packaging guarantee, not a claim that Windows can
observe no activity. Normal launch must not intentionally write KKTerm-owned
state to `%APPDATA%`, `%LOCALAPPDATA%`, or the KKTerm registry keys. Explicit
host integrations can still change the computer: choosing the OS keychain,
configuring an external MCP client, using the Install Helper, opening local
shells, or launching third-party tools all use or modify host state by design.

Portable v1 is **Windows-only**. Writable fixed/local drives and removable
drives are supported. Network shares and cloud-synchronized portable roots are
unsupported because SQLite WAL, WebView2 profiles, and concurrent file sync
cannot be made reliable there. macOS and Linux portable modes require a later
product decision; Linux AppImage packaging remains separate.

---

## 1. Current state (what the plan has to change)

Where installed KKTerm keeps state today:

| State | Location today | Portable-relevant code |
| --- | --- | --- |
| SQLite DB (`kkterm.sqlite3`), incl. encrypted secret store | `app_data_dir()` = `%APPDATA%\com.kkterm.app` | `lib.rs` setup (`db_path`) |
| Assistant skills, AI workdirs, diagnostics, terminal recordings, SSH known hosts, MCP bridge info | `app_data_dir()` | `ai.rs`, `assistant_skills.rs`, `mcp_bridge.rs`, `ssh.rs`, `sessions.rs`, `diagnostics.rs` |
| Backgrounds and fonts | Windows executable directory; `app_data_dir()` on macOS/Linux | `media.rs` |
| Runtime and advanced-debug logs | `Logs/` beside the executable, falling back to `%LOCALAPPDATA%\KKTerm\Logs` | `logging.rs` |
| Update downloads | `app_cache_dir()/updates` | `app_updates.rs` |
| WebView2 profile (localStorage: language, UI state, update-check timestamp; overlay browser partitions) | Tauri default (`%LOCALAPPDATA%\com.kkterm.app\EBWebView`); overlay webviews use per-proxy `data_directory` under `app_data_dir()` | `webview.rs:825` |
| Secrets | OS keychain (`com.kkterm.app` service) **or** the already-shipped encrypted SQLite secret store ("file" store, master password) | `secrets.rs`, `secrets/sqlite_store.rs` |
| Auto-start | HKCU `Run` registry key | `auto_start.rs` |
| Installer detection cache | HKCU `Software\Ryan Tsai\KKTerm\InstallerDetectionCache` | `installer/` |
| Install Helper managed apps | `%LOCALAPPDATA%\KKTerm\installer\apps` | `installer/managed_app.rs` |
| CLI → app bridge discovery | Hardcoded `%APPDATA%\com.kkterm.app\mcp-bridge.json` | `bin/kkterm-cli.rs` |
| App updates (Windows) | Downloads `kkterm-{v}-windows-{arch}-setup.exe` + `.sha256` from GitHub / Cloudflare mirror, verifies, PowerShell handoff runs NSIS after exit | `app_updates.rs` |

Two existing features do a lot of the heavy lifting and should be reused, not
reinvented:

- The **encrypted SQLite secret store** (master password, lives inside
  `kkterm.sqlite3`) is already a fully portable credential backend.
- The **selective export/import `.kkbackup` bundles** (ADR 0010) are already
  the right migration vehicle between installed and portable instances.

---

## 2. Distribution format and on-disk layout

New Windows release asset per arch, alongside the setup exe:

```
kkterm-{version}-windows-x64-portable.zip        (+ .sha256)
kkterm-{version}-windows-arm64-portable.zip      (+ .sha256)
```

ZIP contents / resulting folder layout:

```
KKTerm/
  KKTerm.exe                 same release binary as the installed build
  kkterm-cli.exe             CLI sidecar
  kkterm-portable.marker     empty file; THE portable-mode switch
  resources/                 conceptual bundled-resource root; final physical
                             shape follows verified Tauri resource resolution
  data/                      created on first run — KKTerm-owned mutable state
    kkterm.sqlite3
    backgrounds/  fonts/  assistant-skills/  copilot/
    cache/                   KKTerm-owned portable cache
    logs/
    webview/                 WebView2 user data folder (localStorage, overlay partitions)
    backups/                 startup/manual .kkbackup ZIPs
    diagnostics/
    terminal-recordings/
    ssh_known_hosts
    mcp-bridge.json          present only while the built-in MCP bridge runs
```

Design rules:

- **One binary, two modes.** No separate portable build; mode is decided at
  runtime (section 3). This keeps CI, signing, and the update matrix sane.
- **`data/` is the only location for KKTerm-owned mutable state.** The app
  directory contains the binaries, bundled resources, and marker. Explicit
  host integrations remain the documented exception. This makes "back up the
  portable folder" a complete copy of KKTerm-owned portable state.
- The marker ships inside the ZIP, so extraction alone activates portable
  mode — no launch flags and no first-run mode-selection dialog.
- The ZIP never contains `data/`; extracting a newer ZIP over the portable
  program folder must not overwrite user data.
- The packaging smoke test must verify that the built-in manual and bundled
  assistant skills resolve through Tauri at runtime. The physical resource
  layout must not be assumed from the conceptual tree above.

---

## 3. Launch-time detection (backend)

### Detection order

1. In development and automated tests only, an explicit environment override
   may force portable or installed mode.
2. In release builds, `kkterm-portable.marker` in the executable's directory
   activates portable mode.
3. Otherwise the app runs in installed mode, preserving today's paths and
   behavior.

The NSIS installer must never ship the marker, so an installed copy cannot
accidentally flip modes. Conversely, if `data/kkterm.sqlite3` exists beside the
executable but the marker is missing, startup must show a native error and exit
instead of silently entering installed mode and splitting state across roots.

### Writability guard

Portable mode requires `exe_dir/data` to be creatable and writable. Startup
must perform an actual create/write/delete probe, not just inspect permission
metadata. Reject UNC roots and drives Windows reports as remote, including
mapped network drives. On failure (Program Files, read-only media,
policy-restricted location, or remote drive): show a native error dialog
explaining the problem and exit — do **not** silently fall back to `%APPDATA%`,
which would split the user's data across two roots. The dialog suggests moving
the folder to a writable local or removable drive.

### `AppPaths` abstraction — the core refactor

Introduce one backend module (e.g. `src-tauri/src/app_paths.rs`). Portable mode,
the executable directory, writable data root, WebView2 root, logging root, and
data-root identity must be known before logging or the Tauri builder starts.
Installed-mode Tauri paths can then complete the managed state during setup
without changing their current resolution:

```rust
pub struct AppPaths {
    pub mode: AppMode,          // Installed | Portable
    pub data_dir: PathBuf,      // installed: app_data_dir(); portable: exe_dir/data
    pub cache_dir: PathBuf,     // installed: app_cache_dir(); portable: data/cache
    pub logs_dir: PathBuf,
    pub webview_data_dir: Option<PathBuf>, // installed: Tauri default; portable: data/webview
    pub media_dir: PathBuf,
    pub diagnostics_dir: PathBuf,
    pub recordings_dir: PathBuf,
    pub known_hosts_path: PathBuf,
}
```

Then route every KKTerm-owned durable-path call site (`lib.rs`, `ai.rs`,
`mcp_bridge.rs`, `media.rs`, `ssh.rs`, `sessions.rs`, `assistant_skills.rs`,
`diagnostics.rs`, `webview.rs`, `app_updates.rs`, `ai/cli_backend.rs`, and
`ai/openai_provider.rs`) through managed `AppPaths` state. Do not mechanically
replace host-discovery paths such as `%LOCALAPPDATA%` Install Helper targets,
third-party CLI configuration, browser imports, or user-selected filesystem
paths. Add a policy test that leaves only a documented allowlist of direct
`app_data_dir()` / `app_cache_dir()` calls.

Specific integration points:

- **WebView2 profile**: in portable mode, set the user data folder to the
  resolved portable override before any webview is created
  (`WEBVIEW2_USER_DATA_FOLDER` env var set in `main()` is the reliable Tauri v2
  route). Installed mode leaves Tauri's existing default untouched. This makes
  localStorage — active locale, durable UI state, last-update-check — travel
  with the drive with zero frontend changes. Overlay URL-Connection webviews
  derive their per-proxy `data_directory` from managed app data after the
  path sweep.
- **Asset protocol scope**: `tauri.conf.json` scopes `$APPDATA/backgrounds`
  and `$APPDATA/fonts`, which won't match the portable root. At setup, when
  portable, extend the asset scope at runtime only for the resolved portable
  backgrounds and fonts directories.
- **Single instance**: the current Tauri plugin derives its Windows mutex and
  hidden-window names from the static app identifier and exposes no Windows
  per-instance key. Keep installed behavior unchanged and add an app-owned
  Windows single-instance implementation for portable mode, scoped by a short
  hash of the canonical data root. Each portable root is single-instanced;
  installed and portable roots, and two distinct portable roots, may run
  simultaneously. Secondary portable launches publish their command-line
  arguments through a generation-scoped request file in the user's temporary
  directory before signalling the primary instance, so file/folder launch
  requests reach the correct portable root without adding registry state.
- **MCP bridge / CLI**: pipe names are already per-run random tokens, so no
  collision. The bridge info file moves into `AppPaths.data_dir`. When
  `kkterm-cli` is beside a portable marker, it may look up only its sibling
  `data/mcp-bridge.json`; if that portable app is not running it reports the
  bridge unavailable and must not fall back to the installed instance. A CLI
  without the sibling marker retains the current installed lookup.
- **SQLite on removable media**: keep the existing best-effort WAL behavior,
  verify checkpoint/close on normal process exit, and document that the user
  must quit KKTerm before removing the drive. Do not add database backups to
  the app-window close path.

### Registry and machine-state gating

In portable mode:

- **Auto-start** (HKCU Run): command becomes a no-op returning a typed
  "unsupported in portable mode" error; the Settings toggle is hidden
  (section 6). A registry Run entry pointing at a removable drive is exactly
  the trace portable mode promises not to leave.
- **Installer detection cache** (HKCU): skip the registry cache; fall back to
  an in-memory (per-run) cache. Detection gets marginally slower, correctness
  unchanged.
- **Install Helper managed apps** (`%LOCALAPPDATA%\KKTerm\installer\apps`):
  *stay machine-local by design.* This includes each managed web app's
  executable/runtime, database, uploads, models, logs, and service definition
  (for example n8n, Flowise, Open WebUI, Langflow, and Ollama). Background
  services must remain runnable when the portable drive is absent, so their
  command lines and working directories must never point into portable
  `data/`. Installed and portable KKTerm instances on the same Windows account
  intentionally discover and control the same machine-local app installation.
  The portable folder keeps only KKTerm's Install Helper preferences and
  transient UI state; deleting that folder neither stops nor uninstalls a
  managed app or its Windows service. The Install Helper UI in portable mode
  gets a small persistent caption noting that installs, app data, and services
  apply to the current machine and remain after the portable folder is removed.
- **File associations / protocol handlers / shortcuts**: none are registered
  at runtime today (installer-only) — keep it that way; nothing to do.
- **WebView2 runtime**: the ZIP has no `downloadBootstrapper`. On startup, if
  the Evergreen runtime is missing, show a native dialog linking to
  Microsoft's WebView2 download instead of Tauri's raw failure. (Shipping a
  fixed-version runtime ≈ +150 MB — rejected for v1.)

---

## 4. Updates in portable mode

Portable mode uses **verified ZIP self-updates**. It downloads and stages the
same portable archive published for manual installation, then replaces the
program payload only after the running process has exited. This preserves the
portable storage boundary while avoiding a separate portable installer.

1. Update checks continue to use the current trusted release metadata sources
   and cadence. The main WebView2 profile lives in `data/webview`, so the
   `lastUpdateCheck` localStorage value travels with the portable root.
2. When an update is available, the portable prompt identifies it as a
   Portable ZIP update and offers a download, update, and restart action plus
   the release page as a manual fallback.
3. Rust downloads the exact architecture-specific ZIP into
   `data/cache/updates`, verifies the published SHA-256, and extracts it into a
   same-volume staging directory. Extraction rejects traversal paths, symbolic
   links, oversized archives, unexpected top-level entries, missing required
   payload entries, and any attempt to include `data/`.
4. Backend validation is mode-aware: a portable process rejects `-setup.exe`
   requests, and an installed process rejects portable ZIP requests. A
   portable instance never launches NSIS or creates an installed copy.
5. After staging succeeds, KKTerm spawns a hidden detached handoff and exits
   with `app.exit(0)`, preserving the normal portable SQLite WAL checkpoint.
   The handoff waits for that process to finish, moves the current executable,
   CLI, manual, and Assistant Skills into a rollback directory, moves the
   staged payload into place, and relaunches `KKTerm.exe`. It retains the
   existing marker and never moves, deletes, or replaces `data/`.
6. A swap or relaunch-command failure restores the previous program payload,
   writes `data/logs/portable-update.log`, and relaunches the old executable.
   Successful replacement removes the downloaded archive, staging files, and
   rollback directory.

---

## 5. Credentials and secrets

The OS keychain is machine- and user-bound — secrets stored there do not
travel and would silently "disappear" when the stick moves to another PC.
KKTerm already has the right portable backend: the **encrypted SQLite secret
store** inside `kkterm.sqlite3` (master password, presence checks without
unlock, lock/unlock lifecycle — all shipped).

Plan:

- **Portable default**: first run in portable mode defaults
  `credential_settings.secret_store` to `"file"` when no credential-setting
  row exists. The onboarding recommends master-password setup but is
  **skippable**. If the user skips it, the existing deferred setup/unlock flow
  runs when a feature first needs to save or read an encrypted secret.
- **Explicit opt-out**: the user may still pick the OS keychain in portable
  mode from Settings, but onboarding does not promote that machine-bound
  choice. Credentials Settings warns that those secrets stay on the current
  machine. (Owner IDs are per-DB UUIDs, so sharing the `com.kkterm.app`
  keychain service with an installed instance cannot collide.)
- **No password material near the stick**: documentation and UI must never
  suggest putting `KKTERM_SECRET_STORE_PASSWORD` in a launcher script beside
  the exe — that defeats the encryption. The existing Settings warning copy
  already covers this; the manual chapter repeats it for portable.
- **Threat model honesty**: on a lost stick, secrets are covered by the
  encrypted store; *non-secret* data (hostnames, usernames, notes, IT Ops
  inventory) is plaintext SQLite. Document this clearly. Full-database
  encryption (SQLCipher-style) is explicitly out of scope for v1 and tracked
  as a possible follow-up.
- **Migration installed ⇄ portable**: no new mechanism. The `.kkbackup`
  selective export/import (ADR 0010) already carries segments plus the
  encrypted secrets blob where applicable. Add one UX affordance: portable
  first-run offers "Import from a KKTerm backup" so the
  installed → portable move is one export + one import.

---

## 6. Frontend UI/UX

All new strings go through i18n per the repo rules (`en.json` first, one
pending file per key under `docs/localization_todo/`).

- **Mode surface**: a new `get_app_mode` command exposes
  `{ mode, dataDir }`. Settings → About shows a "Portable" badge, the data
  folder path, and an "Open data folder" button. The title bar and the rest
  of the chrome stay identical — portable is not a different product.
- **First-run portable onboarding** (one concise, skippable dialog, not a
  wizard): show the portable data path, explain that passwords can be
  encrypted while non-secret Connection/settings data remains plaintext, and
  offer three actions: auxiliary "Import backup", primary "Set up encrypted
  storage", and dismiss "Not now". Close onboarding before opening the reused
  encrypted-store or selective-import dialog; never nest dialogs. Do not put
  the OS keychain choice in onboarding.
- **Settings deltas in portable mode**:
  - General → auto-start toggle hidden.
  - Credentials → "file" store shown as recommended; OS store carries the
    machine-bound warning.
  - General/Update → update panel says "Portable ZIP update" and opens the
    matching portable download rather than offering installer handoff.
  - About → portable badge, exact data path, and Open Data Folder action.
  - Install Helper → caption that installs are machine-local.
- **Installed-to-portable creator**: installed Windows exposes
  `settings.portableCreatorAction` under General → Portable Install. Its two-step
  wizard selects the existing selective-export categories and an empty local
  or removable destination, then copies the running architecture's executable,
  CLI, manual, and bundled Assistant Skills and creates a launch-ready
  `data/kkterm.sqlite3`. Connections require Workspaces. Credentials and
  encrypted-secret rows are never copied; auto-start is forced off and the
  portable credential backend returns to the normal first-run encrypted-file
  recommendation. Creation is staged inside the selected folder, rejects
  network/non-empty/install-directory targets, rolls back only files it placed,
  and writes the portable marker last. The completion state can open the folder
  or launch the new portable instance alongside the installed instance.
- **No permanent mode chrome**: do not add a title-bar badge, alternate theme,
  or duplicate product identity. Portable mode stays inspectable in About and
  appears only where it changes a decision.
- **Manual**: extend `docs/manual/17-data-backup-secrets.md` (data location
  table gains the portable column) and `docs/manual/15-settings.md`
  (mode badge, hidden auto-start), plus `docs/manual/18-installer.md` for the
  machine-local Install Helper notice; reference i18n keys, not English labels.

---

## 7. Coexistence: installed + portable on the same machine

Guaranteed by construction, verified by tests:

| Concern | Resolution |
| --- | --- |
| Data mixing | Impossible — disjoint roots (`%APPDATA%` vs `exe_dir/data`); no fallback path ever crosses over (see writability guard). |
| Both running at once | Supported: the app-owned portable single-instance identity is scoped per data root. Two copies of the *same* portable folder remain single-instanced, and later path arguments are forwarded to that root's running instance. |
| CLI targets the wrong app | A CLI beside the portable marker resolves only sibling `data/mcp-bridge.json`; it never falls back to the installed app. Pipe names remain per-run tokens. |
| Updates cross-contaminate | Portable mode uses verified ZIP self-updates, and mode-aware backend validation rejects installer assets from portable processes and ZIP assets from installed processes. The handoff replaces only the fixed program payload and never `data/`. |
| Keychain overlap | Same service name is fine — owner IDs are per-DB UUIDs; portable default is the file store anyway. |
| WebView2 profiles | Disjoint (`data/webview` vs `%LOCALAPPDATA%\com.kkterm.app\EBWebView`). |
| Managed apps / Install Helper | Shared machine state by design; both instances see the same installed tools — that is the correct model. |
| Uninstalling/deleting | NSIS uninstall never touches the portable folder. Deleting the portable folder removes KKTerm-owned portable state; explicit host integrations such as OS-keychain entries or installed tools remain host-owned. |

---

## 8. Packaging and release pipeline

- **`scripts/package-portable.ps1`** with an `-Arch` switch: runs after the
  normal Tauri release build and assembles the ZIP from the exact same release
  `KKTerm.exe` used by the installer build, `kkterm-cli.exe`, the verified
  Tauri resource layout, and a freshly created `kkterm-portable.marker`; emits
  the `.sha256`. "Same release executable" is the current guarantee;
  Authenticode signing becomes part of that guarantee when signing is restored.
- **Release scripts** (`release-github*.ps1`) upload the portable assets;
  `sync-cloudflare-release.mjs` mirrors them; `generate-release-notes.mjs`
  lists them.
- **`scripts/smoke-portable.ps1`**: extract to a temp dir, launch, assert
  (a) `data/` appears next to the exe with the DB inside, (b) nothing new
  in the known KKTerm-owned paths under `%APPDATA%` / `%LOCALAPPDATA%`,
  (c) no HKCU auto-start or detection-cache keys created, (d) second launch
  from the same folder focuses the first (single instance), (e) app exits
  cleanly (WAL checkpointed), and (f) the bundled manual and assistant skills
  resolve in the packaged runtime. The smoke test uses only an explicit
  temporary extraction directory and exact registry/path snapshots; it must
  not delete broad user-data roots.
- **Docs**: README download table, `docs/SITE.md`/site release worker if it
  lists assets, `docs/ANTIVIRUS.md` (portable ZIPs are more often flagged
  than installers; publish checksums, restore Authenticode signing when
  available, and document how to report false positives).

---

## 9. Phasing

Each phase is independently testable. The public portable release ships only
after phases 1–4 are complete.

1. **Path core** — early mode detection, missing-marker and writability guards,
   managed `AppPaths`, logging/WebView2 redirection, asset-scope extension, and
   the audited durable-path sweep. Development/tests may force mode before any
   portable package exists. Installed behavior must remain unchanged.
2. **Host-state + coexistence** — portable Windows single-instance handling,
   marker-aware CLI bridge discovery, auto-start gating, in-memory Install
   Helper detection cache, mode-aware update validation, and clean SQLite exit
   verification.
3. **Secrets + UX** — portable default to the file store when unset,
   skippable onboarding, Settings deltas, typed app-mode/data-path access, i18n
   keys plus pending localization files, and operation-manual updates.
4. **Packaging + release** — x64/ARM64 ZIP and checksum generation,
   release/mirror/notes integration, README/antivirus guidance, and the portable
   smoke test. Portable mode self-updates from the same verified release ZIPs.
5. **Later / out of scope for v1** — macOS/Linux portable modes,
   network-share roots, cloud-synchronized roots, full-database encryption,
   and a machine-local WebView2 profile redirect.

### Implementation verification

The implementation ships `package:portable`, `package:portable:arm64`, and
`smoke:portable`. Current x64 and ARM64 release builds produce checksummed ZIPs
with the correct PE architecture, marker, CLI, operation manual, and Assistant
Skills, and no pre-created `data` folder. The x64 packaged-runtime smoke covers
portable data/WebView/log creation, resource resolution, same-root activation,
installed-path and registry isolation, and clean SQLite WAL checkpointing.
ARM64 cross-build and archive validation run on x64; execution still requires
an ARM64 Windows runner or device. Portable releases self-update from these
same verified archives through the staged post-exit handoff described above.

Installed Windows builds also ship the Settings portable-copy creator. Rust
coverage verifies selective database creation, credential/auto-start
normalization, category dependencies, empty-folder protection, and recursive
resource copying; frontend policy coverage guards the installed-only launcher
and the no-credentials contract.

---

## 10. Risks and resolved product decisions

- **Slow/flaky removable media**: SQLite + WebView2 profile on a slow USB 2
  stick will feel it. Portable v1 keeps the WebView2 profile portable anyway;
  redirecting it to host storage would weaken the core guarantee and is not a
  v1 option.
- **Network/cloud roots**: network shares, OneDrive, Dropbox, and equivalent
  synchronized roots are unsupported. The UI error/manual copy must recommend
  a writable local or removable drive.
- **Removable filesystems**: FAT32/exFAT and deeply nested extraction paths
  require real smoke/manual coverage. The app must surface initialization or
  SQLite failures instead of assuming all removable filesystems behave alike.
- **Antivirus heuristics**: portable ZIPs and self-replacing application flows
  are commonly scrutinized more than installers. Publish SHA-256 checksums,
  keep the handoff narrow and user-mediated, and document false-positive
  reporting. Restored Authenticode signing remains a release goal.
- **Marker decision**: the explicit `kkterm-portable.marker` is the production
  mode switch. A portable-shaped database without the marker is treated as an
  ambiguous/error state, never as permission to silently use installed paths.
- **First-run language**: a new `data/webview` profile has no stored locale, so
  the existing system-language detection is the accepted portable first-run
  behavior.
- **Credentials onboarding**: encrypted portable credentials are recommended,
  but setup is skippable and deferred until first secret use when skipped.
- **Updates**: portable updates use verified ZIP staging, a post-exit program
  payload swap, rollback on swap/relaunch-command failure, and automatic
  relaunch. The existing `data/` directory is outside the replacement set.

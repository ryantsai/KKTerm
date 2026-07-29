# Linux Port Plan

Status: **Planning** — no Linux code written yet.

This is the living plan for porting KKTerm to Linux. It is intentionally
multi-phase: get it to compile, get it to run, restore subsystems one at a time,
then package. Update the checkboxes and the disposition table as work lands.

## 1. Goal and Constraints

**Goal:** ship a working Linux build of KKTerm **without affecting the
Windows or macOS builds**.

Hard constraints, in priority order (from the port owner):

1. **Do no harm to Windows/macOS.** No change may regress or risk the existing
   Windows or macOS builds in a major way. When a dependency version, feature,
   or build setting would force a change to the shared/Windows/macOS path, the
   Linux side yields.
2. **Linux is lowest priority.** Where a conflict exists (e.g. a crate that
   pins an incompatible transitive version, a system library that complicates
   the build), **a Linux feature may be sacrificed** rather than perturbing the
   other platforms. Document each sacrifice in the disposition table below.
3. **AppImage-only distribution.** To avoid the Linux dependency matrix
   (libwebkit2gtk versions, glibc spread, packaging per-distro), KKTerm ships on
   Linux as a single self-contained **AppImage**. No `.deb`, no `.rpm`, no
   Flatpak, no Snap, no distro packages. (This narrows ROADMAP item
   "Linux packaging (AppImage/deb/rpm)" to AppImage only.)

Non-goals for the first Linux release: feature parity with Windows, the
Install Helper Module, and any Windows-developer-tool catalog.

## 2. Where We Stand (codebase reality)

KKTerm is Tauri v2 (Rust backend, React/TS frontend). The macOS port already
forced the backend to grow a non-Windows code path, which is the single biggest
head start for Linux: a large amount of platform code is gated as
`cfg(not(target_os = "windows"))` rather than `cfg(target_os = "macos")`, and
those branches will compile and largely run on Linux.

Concrete signals from the tree:

- `Cargo.toml` already has a `cfg(not(target_os = "windows"))` dependency block
  that brings in `surge-ping` (Unix ICMP), `ironrdp` + `ironrdp-tokio`,
  `tokio-rustls`, `rustls`, `x509-cert`. **RDP already has a non-Windows
  IronRDP client path** (`src-tauri/src/rdp_client.rs`), so RDP is not
  Windows-only at the source level.
- VNC uses the cross-platform `vnc-rs` (vendored under `src-tauri/vendor/`).
- SSH/SFTP/FTP/Telnet/Serial use cross-platform crates (`russh`, `russh-sftp`,
  `suppaftp`, `serial2`) — portable.
- `portable-pty` backs the terminal; it supports Unix ptys.
- `rusqlite` is `bundled` — no system SQLite needed.
- `keyring-core` is the secret abstraction, but `configure_default_store()` in
  `src-tauri/src/secrets.rs` explicitly returns an error for
  `cfg(not(any(windows, macos)))` — **Linux has no keychain backend yet.**
- `src-tauri/src/performance.rs` has Windows (hand-rolled Win32) and macOS
  (`sysinfo`) host-metric paths but **no Linux path** — several
  `cfg(target_os = "macos")` blocks have no non-macOS fallback.
- `src-tauri/src/lib.rs` already contains ~30 `cfg(not(target_os = "windows"))`
  command/registration branches (lines ~2655–3300), meaning a meaningful slice
  of the app is already wired for the non-Windows case.

So the work is less "write a port from scratch" and more "find every
`cfg(target_os = "macos")` / `cfg(target_os = "windows")` pair that leaves Linux
with no implementation, and give Linux either the macOS-shared path, a small
native impl, or a documented no-op."

### Platform `cfg` inventory (files to audit)

Backend files containing platform `cfg` that must be reviewed for a Linux gap
(from `rg "target_os" src-tauri/src`):

`lib.rs`, `secrets.rs`, `performance.rs`, `power.rs`, `screenshot.rs`,
`webview.rs`, `window_effects.rs`, `window_state.rs`, `system_theme.rs`,
`app_tray.rs`, `auto_start.rs`, `native_tooltip.rs`, `sessions.rs`, `sftp.rs`,
`ssh.rs`, `ssh_keys.rs`, `storage.rs`, `rdp.rs`, `x_server.rs`,
`net/ping.rs`, `ai/cli_backend.rs`, `ai_coding_usage.rs`, `app_launcher.rs`,
`app_updates.rs`, `mcp_bridge.rs`, `debug_heartbeat.rs`, `auto_start.rs`,
`bin/kkterm-cli.rs`, and the whole `installer/` module.

Audit rule of thumb for each `#[cfg(target_os = "macos")]` block: does Linux
need this behavior? If yes and the macOS impl is portable (e.g. `sysinfo`),
widen the gate to `cfg(unix)` or `cfg(any(macos, linux))`. If it's truly
Apple-specific (IOKit, Security.framework), add a Linux sibling block. If Linux
can live without it, add a `cfg(target_os = "linux")` no-op/stub so it compiles.

## 3. Strategy / Engineering Principles

- **Additive gating only.** Never change the meaning of an existing
  `cfg(target_os = "windows")` or `cfg(target_os = "macos")` block. Add Linux by
  widening a gate to `cfg(unix)` / `cfg(not(windows))` **only when the existing
  body is already portable**, otherwise add a new `cfg(target_os = "linux")`
  block. This keeps Windows/macOS byte-for-byte unchanged.
- **Compile-gate Linux dependencies.** Any new crate for Linux goes under a
  `[target.'cfg(target_os = "linux")'.dependencies]` block so it never enters
  the Windows/macOS dependency graph and cannot cause version conflicts there
  (Constraint 1).
- **Prefer "feature off" over "feature broken."** When a subsystem can't be
  ported cheaply, make it a clean no-op that the frontend can detect and hide,
  rather than a runtime error. The frontend already hides/guards Windows-only
  surfaces in places; extend that with a platform capability signal.
- **One platform-capability source of truth.** Add a backend command (or extend
  an existing startup payload) reporting the OS and which optional subsystems are
  available (keychain, installer, screenshot, RDP-native, don't-sleep, tray,
  window effects). The frontend gates UI off this instead of sniffing the
  platform ad hoc.
- **No `cargo fmt` over the workspace** (per AGENTS.md). Format only files you
  intentionally touch, Rust 2024 edition.

## 4. Phased Plan

Each phase has a concrete success criterion. Do not start a later phase's polish
before the earlier phase's criterion is met.

### Phase 0 — Compiles on Linux
**Success: `cargo check --manifest-path src-tauri/Cargo.toml` passes on Linux
(x86_64), `npm run build` unaffected.**

> **Result (2026-06-14, pb60 / Ubuntu 24.04.4, branch `8b825890`):**
> `cargo check` **passes — 0 errors, 97 warnings.** The backend compiles on
> Linux unchanged; the macOS `cfg(not(target_os = "windows"))` paths cover Linux
> at the compile level. The 97 warnings are **all benign dead-code** — Windows/
> macOS-only functions, structs, and constants that are simply unused on Linux,
> concentrated in `mcp_bridge.rs` (35), `performance.rs` (15), `rdp.rs` (9),
> `installer/*` (15), `screenshot.rs`/`window_state.rs`/`x_server.rs`/
> `native_tooltip.rs`. They confirm the runtime gaps (no Linux metrics path, no
> installer, no screenshot, etc.) rather than any compile blocker. These will be
> resolved as Phase 2+ Linux implementations land or via targeted
> `#[cfg]`/`#[allow]` gating in a later cleanup pass — not by editing shared or
> Windows/macOS code now.
>
> Net: **Phase 0 is effectively done at the compile level.** The real work is
> Phase 2+ runtime implementations, not getting it to build. (Note: a frontend
> `dist/` is required for `tauri-build`; a stub `dist/index.html` was used to
> isolate the backend check. The full AppImage build still needs `npm run
> build` first.)

- [~] Linux dev/build box: **pb60** (Ubuntu 24.04.4 LTS, x86_64, 6 cores,
      15 GiB) is the build host. SSH as `ryan` (key auth). Done in userspace:
      Rust 1.96.0 (rustup), Node 22 + npm (nvm). Repo present at
      `/home/ryan/KKTerm`. **Blocked:** Tauri system deps need `sudo` and pb60
      has no passwordless sudo. Required packages (Ubuntu 24.04):
      `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
      librsvg2-dev libgbm-dev libssl-dev build-essential pkg-config
      libfuse2t64`.
- [ ] Run `cargo check` for `target_os = "linux"`; collect every compile error.
- [ ] For each missing-implementation error, add the minimal
      `cfg(target_os = "linux")` block (stub/no-op/Err) so it compiles. Track
      each stub as a TODO referencing this doc.
- [ ] Add the `[target.'cfg(target_os = "linux")'.dependencies]` block for any
      Linux-only crates introduced (likely: a Secret Service keyring store;
      possibly nothing else if `sysinfo` is reused).
- [ ] Confirm `cargo check`/`cargo check` for Windows + macOS still pass
      (no shared graph change).

### Phase 1 — Launches and renders
**Success: AppImage-less `cargo tauri dev` (or a dev build) opens the window,
loads the React app under WebKitGTK, and the app shell renders.**

- [ ] Verify WebKitGTK renders the frontend (xterm, Tailwind, fonts). Note any
      WebKit-vs-WebView2 rendering/behavior deltas (WebGL availability for the
      xterm `addon-webgl`, backdrop filters used by window effects, CSS that
      assumed Chromium).
- [ ] System tray via `libayatana-appindicator3` (`tauri` `tray-icon` feature) —
      confirm the tray + minimize-to-tray path. Tray behavior differs across
      desktop environments (GNOME needs an extension); decide the fallback.
- [ ] Window decorations / titlebar: confirm the custom chrome works under the
      Linux WM, including the documented native minimize-to-tray close handler
      (`docs/ARCHITECTURE.md`). Do NOT add frontend close hooks (High-Risk
      Invariant).
- [x] `tauri-plugin-single-instance` is shared across desktop targets so Linux
      forwards later launch arguments to the running app and restores its window.

### Phase 2 — Core subsystems
**Success: local terminal, SSH/SFTP, secrets, and Status Bar metrics work on
Linux.**

- [ ] **Terminal/PTY:** local shell via `portable-pty` on Unix; default shell
      detection for Linux (`$SHELL` → bash). The Windows terminal options
      (PowerShell/cmd/WSL) are Windows-only — Linux offers the user's shells.
- [ ] **SSH/SFTP/FTP/Telnet/Serial:** expected to work as-is (portable crates);
      validate against a real host. Serial device paths differ (`/dev/ttyUSB*`).
- [ ] **Secrets keychain (DECIDED):** implement `configure_default_store()` for
      Linux via the freedesktop Secret Service (libsecret /
      `org.freedesktop.secrets`, satisfied by gnome-keyring or KWallet) as the
      preferred backend. Add a Linux-only keyring-core Secret Service store crate
      under the Linux dep block. **When no Secret Service is available**
      (headless/minimal desktops), fall back to an **encrypted SQLite secret
      store**: the user must enter a **password seed** that derives the
      encryption key (KDF — e.g. Argon2/scrypt — over the seed; never store the
      seed). The seed is requested on first secret write and on each app start
      that needs to unlock the store; if the user declines, secret-dependent
      flows are blocked until unlocked. Design notes:
      - Implement as a `keyring_core` store so the rest of `secrets.rs` is
        unchanged; only `configure_default_store()` and a small unlock/seed-entry
        path are Linux-specific.
      - Store encrypted rows in a dedicated SQLite table, clearly separate from
        durable Connection data.
      - The seed-entry UI needs new i18n strings (en.json first + pending files).
      - This is the one place we add real Linux-specific security code rather
        than reusing a platform path — keep it small and auditable.
- [x] **Host metrics (`performance.rs`):** done (2026-07-05). The sysinfo-based
      macOS metric blocks are widened to `cfg(any(macos, linux))` (`sysinfo` was
      already a Linux dep for PC Info), reporting `linux-sysinfo` sources.
      Status Bar CPU/RAM/network + Dashboard counters populate; the Status Bar
      metrics click launches the first installed desktop system monitor
      (GNOME System Monitor, plasma-systemmonitor, …) via
      `open_windows_task_manager`.
- [ ] **System theme (`system_theme.rs`):** detect dark/light via the
      `org.freedesktop.appearance` `color-scheme` portal (or GTK setting); fall
      back to light if unavailable.
- [x] **Don't Sleep (`power.rs`):** done (2026-07-05) — no longer sacrificed.
      Implemented via the `org.freedesktop.portal.Inhibit` portal (suspend +
      idle flags; GNOME and KDE both back it) with a legacy
      `org.freedesktop.ScreenSaver` D-Bus fallback, over `zbus` (already in the
      tree via tauri-plugin-opener/xcap).

### Phase 3 — Connection types beyond terminal
**Success: VNC and RDP open on Linux; URL/WebView connections render.**

- [x] **RDP:** frontend enabled (2026-07-05): `usesCanvasRdp()`/`supportsRdp()`
      now include Linux, so the workspace renders the IronRDP canvas
      (`RdpCanvasView`) instead of falling into the Windows ActiveX overlay
      path (which showed the "ActiveX host" status text on Linux). The backend
      `rdp_client.rs` commands were already compiled `cfg(not(windows))`.
      Needs an end-to-end connect validation against a real Windows host.
- [ ] **VNC:** `vnc-rs` framebuffer path is platform-neutral — validate.
- [ ] **URL/WebView Connections (`webview.rs`):** Windows uses an owned overlay
      `WebviewWindow` over the Pane (the borderless WebView2 overlay). Confirm
      the overlay-window approach works under WebKitGTK, or fall back to Tauri's
      standard child webview. `window_effects.rs` (Mica/Acrylic) is
      Windows-only and should be a no-op on Linux.

### Phase 4 — Feature dispositions (sacrifices)
**Success: every Windows/macOS-only surface is cleanly hidden or no-op'd on
Linux via the platform-capability signal — no broken buttons, no error spam.**

- [ ] **Install Helper Module — SACRIFICED v1:** the catalog is
      Windows-developer-tool-centric (winget, WSL, Windows features…). Hide the
      Module entirely on Linux behind the capability flag and skip building its
      backend command surface on Linux where practical. A Linux catalog (apt/dnf/
      flatpak/brew) is explicitly out of scope.
- [ ] **Screenshot capture (`screenshot.rs`) — SACRIFICED v1:** ship as a
      documented no-op; hide the AI screenshot-to-context affordance on Linux via
      the capability flag. Revisit with Wayland/X11 portal capture later.
- [ ] **Auto-start (`auto_start.rs`) — SACRIFICED v1:** no-op on Linux; hide the
      auto-start setting. (XDG autostart `.desktop` is a cheap later add.)
- [ ] **Native tooltips / native context menus:** confirm `native_tooltip.rs`
      and `nativeContextMenu` behave under GTK; fall back to existing DOM
      paths where they don't.
- [x] `app_launcher.rs` audited + fixed (2026-07-05): the opener plugin spawned
      xdg-open with the AppImage-poisoned environment (rewritten XDG_DATA_DIRS/
      GIO vars broke MIME resolution → everything opened in the default
      browser). Linux launches now go through host spawns with the shared
      AppImage env scrub (`linux_env.rs`): exec-bit files run directly,
      `.desktop` entries launch via `gio launch`, everything else opens via
      `xdg-open` (fallback `gio open`).
- [ ] Audit `ai/cli_backend.rs` and `ai_coding_usage.rs` (CLI path
      discovery — already has a Linux branch at `ai_coding_usage.rs:863`),
      `mcp_bridge.rs`, and `x_server.rs` (managed X server is a Windows
      VcXsrv/XLaunch concept; on Linux X11 is native — likely no-op the managed
      X server Status Bar indicator).

### Phase 5 — Packaging (AppImage)
**Success: a single `kkterm-<version>-linux-x86_64.AppImage` builds, launches on
a clean Ubuntu, and runs the smoke path (open window, open a local terminal).**

> **Result (2026-07-05, Fedora 44 VM against a build made on Ubuntu 24.04 CI):**
> the AppImage launched to an **empty window** — two independent, stacked bugs:
> 1. linuxdeploy bundles the build host's `libwayland-client.so.0`,
>    `libwayland-egl.so.1`, `libwayland-cursor.so.0`, `libwayland-server.so.0`
>    into the AppImage. Wayland's protocol marshalling must match the
>    *running* machine's Mesa/EGL stack; the mismatch aborted the app before
>    any window rendered with `Could not create default EGL display:
>    EGL_BAD_PARAMETER. Aborting...` (confirmed via `journalctl`:
>    `WebKitWebProcess` never spawned and SIGABRT'd). Fix: `scripts/
>    package-linux.sh` now extracts the built AppImage, deletes those four
>    `.so` files, repacks with `appimagetool`, and re-signs the updater
>    signature (`tauri signer sign`).
> 2. Even with (1) fixed, WebKitGTK's DMA-BUF renderer fails **silently**
>    under some virtualized graphics stacks — the process and
>    `WebKitWebProcess` stay alive, nothing crashes, but the webview renders
>    nothing. Fix: `src-tauri/src/main.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`
>    before Tauri/GTK init, gated to Linux and only when `systemd-detect-virt
>    --vm` reports a hypervisor (so bare-metal Linux keeps the faster
>    DMA-BUF path).
>
> Both fixes were validated end-to-end on the Fedora VM: extract → strip →
> repack with `appimagetool` → relaunch showed no crash and a visibly
> rendered window.
>
> **Follow-up (2026-07-05, v0.1.112 on the same Fedora 44 VM):** still blank —
> a third bug in fix (2) itself. AppImage's AppRun wrapper exports
> `LD_LIBRARY_PATH` pointing at the bundled libs, and the spawned host
> `systemd-detect-virt` inherited it, aborting with
> ``libcrypto.so.3: version `OPENSSL_3.4.0' not found`` (bundled Ubuntu
> OpenSSL 3.0 vs. Fedora 44's `libsystemd-shared` needing 3.4 symbols) — so
> VM detection reported "not a VM" and the DMA-BUF workaround never engaged.
> Fix: `main.rs` scrubs `LD_LIBRARY_PATH` when spawning the detector. The
> same leak reaches terminal shells and the spawned host `ssh` (which
> silently loaded the *bundled* libcrypto), so `sessions.rs` now scrubs all
> AppImage-injected variables (`LD_LIBRARY_PATH`, `GTK_*`, `GDK_*`,
> `GIO_EXTRA_MODULES`, `GSETTINGS_SCHEMA_DIR`, `XDG_DATA_DIRS` entries under
> `$APPDIR`, `APPDIR`/`APPIMAGE`/`ARGV0`/`OWD`) from local-shell and ssh
> children; no-op outside an AppImage.

- [ ] Add `appimage` to a **Linux-only** bundle target. Do NOT add it to the
      shared `tauri.conf.json` `bundle.targets` (which is `nsis`/`app`/`dmg`);
      use a Linux config overlay (`src-tauri/tauri.linux.conf.json` passed via
      `--config`, or a per-target invocation) so Windows/macOS bundling is
      untouched (Constraint 1).
- [ ] Provide Linux desktop metadata: `.desktop` entry, icon set (the existing
      PNGs in `src-tauri/icons/` suffice; AppImage needs a 256×256+).
- [x] Write `scripts/package-linux.sh` (bash, mirrors `package-macos.sh`
      shape): `tauri build --target x86_64-unknown-linux-gnu --bundles appimage`.
      Wired as `npm run package:linux`. AppImage target is selected via CLI, not
      added to the shared `tauri.conf.json` (Windows/macOS bundling untouched).
- [ ] Add a Linux smoke script (headless launch under `xvfb-run`, assert the
      process stays up and a window/health signal appears) analogous to
      `scripts/smoke-installer.ps1`.
- [ ] aarch64 Linux: **out of scope** (x86_64 only for v1).

### Phase 6 — Updater and release automation
**Success: Linux AppImage is published to GitHub Releases by an automated job;
update-check behavior on Linux is defined.**

- [x] **Updater:** Linux uses the signed Tauri updater path for AppImage
      releases. `src-tauri/tauri.linux.conf.json` enables
      `createUpdaterArtifacts`, `scripts/package-linux.sh` loads the updater
      signing key, and `scripts/release-github-linux.sh` uploads the AppImage,
      `.sig`, `.sha256`, and merged `latest.json` with a `linux-x86_64` entry.
- [x] **Release CD:** `.github/workflows/release.yml` runs the Linux AppImage
      job after Windows and macOS release jobs succeed. The Linux job runs on
      `ubuntu-24.04`, installs Tauri build deps, builds the AppImage, and uploads
      + patches notes via `scripts/release-github-linux.sh`. Like the macOS
      helper it **only builds + uploads + patches notes**: no version bump, no
      tag creation (attaches to the existing release the Windows flow created).
- [x] Added `release:github:linux` npm script mirroring `release:github:macos`.
- [ ] (Optional, later) Wire a build-only AppImage check into `ci.yml` so Linux
      breakage is caught on PRs.

### Phase 7 — Docs, manual, i18n
**Success: shipped docs reflect Linux; no untranslated strings introduced.**

- [ ] Update `docs/RELEASE.md` (add the AppImage section), `docs/ROADMAP.md`
      (mark AppImage in progress / scope-narrow the deb/rpm line),
      `docs/ARCHITECTURE.md` (Linux platform notes, capability signal),
      and `README` install instructions.
- [ ] Manual: any UI behavior that differs on Linux (hidden Install Helper,
      no Don't Sleep, etc.) must update the relevant `docs/manual/*` chapter,
      referencing i18n keys (AGENTS.md rule).
- [ ] Any new user-visible strings (e.g. "Keychain unavailable on this system")
      follow the i18n flow: English key first in `src/i18n/locales/en.json`,
      plus a pending file per key under `docs/localization_todo/`.
- [x] Update `AGENTS.md` "Project Shape" line to include Linux
      support is in progress and best-effort.

## 5. Subsystem Disposition Table

Working-state target for the **first Linux release**. Update as phases land.

| Subsystem | Windows | macOS | Linux v1 plan | Risk |
|---|---|---|---|---|
| Local terminal (PTY) | native | native | `portable-pty` Unix | low |
| SSH / SFTP / FTP / Telnet | russh etc. | same | same (portable) | low |
| Serial | serial2 | serial2 | serial2 (`/dev/tty*`) | low |
| SQLite storage | bundled | bundled | bundled | low |
| Secrets / keychain | Cred Manager | Keychain | Secret Service; else encrypted SQLite w/ password seed | **med** |
| Host metrics (Status Bar) | Win32 | sysinfo | sysinfo (reuse) | low |
| System theme | native | native | freedesktop portal | low |
| VNC | vnc-rs | vnc-rs | vnc-rs | low |
| RDP | ActiveX | IronRDP | IronRDP (mac path, enabled) | med |
| URL / WebView | WebView2 overlay | WKWebView | WebKitGTK overlay/child | **med** |
| Window effects (Mica) | yes | n/a | no-op | none (cosmetic) |
| Tray / minimize-to-tray | yes | yes | appindicator (DE-dependent) | med |
| Don't Sleep | yes | yes | inhibit portal + ScreenSaver D-Bus | low |
| Screenshot → AI context | yes | yes | **sacrificed v1** (no-op) | med |
| Auto-start | yes | yes | **sacrificed v1** (no-op) | low |
| Install Helper Module | yes | (n/a) | **sacrificed v1** (hidden) | n/a |
| Managed X server indicator | yes | n/a | **no-op** (X11 native) | none |
| Updater self-install | checksum | signed Tauri updater | signed AppImage updater | low |
| Distribution | NSIS | DMG | **AppImage only** | med |

## 6. Validation / Gates

Per AGENTS.md, the full suite (`npm run check`, `npm run build`, `cargo check`,
`cargo test`) runs before handing back significant changes. Linux-specific
additions:

- `cargo check` must pass for **all three** targets after every phase
  (Windows + macOS must stay green — this is the do-no-harm gate).
- `cargo test` on Linux for the portable test suites (secrets tests use a mock
  store; confirm they pass on Linux).
- Manual Linux smoke per Phase 5 (window opens, local terminal opens, SSH
  connects) — the equivalent of the documented "validate in the real Tauri
  runtime, not Vite preview" rule.
- A clean-machine AppImage launch test (no dev libraries installed) is the real
  portability gate, since AppImage is the only distribution.

## 7. Decisions (resolved)

1. **Secret Service fallback — RESOLVED.** Prefer Secret Service; when
   unavailable, fall back to an **encrypted SQLite secret store keyed by a
   user-entered password seed** (KDF-derived key; seed never stored). See Phase 2
   secrets task for the design.
2. **Don't Sleep / Screenshot / Auto-start — RESOLVED:** ship as no-ops in v1.
3. **Install Helper Module — RESOLVED:** removed/hidden on Linux in v1.
4. **aarch64 Linux — RESOLVED:** **x86_64 only** for now.

Still open (low-stakes, can default during implementation):

- **Base distro / glibc.** Proposing Ubuntu 24.04 as the build base for AppImage
  portability. Will default to this unless told otherwise.
- **WebKitGTK rendering deltas.** If xterm WebGL or window-effect CSS misbehave
  under WebKitGTK, default to the canvas/2D fallback on Linux.

## 8. First Concrete Step

Phase 0, task 1–2: stand up an Ubuntu 24.04 build environment and run
`cargo check` for Linux to produce the real, exhaustive list of compile gaps.
Everything after that is driven by that error list, not by guesswork in this
document.

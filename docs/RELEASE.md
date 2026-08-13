# KKTerm Release Notes and Gates

This document captures KKTerm release posture, packaging procedures, and current known limitations.

## No-Telemetry Posture

KKTerm is local-first by default.

- The app does not include analytics, automatic crash upload, or background telemetry.
- The app-wide Status Bar shows Workspace host usage metrics and universal transient notices only. It does not upload telemetry and no longer presents debug timing budgets.
- Terminal contents are not logged by default.
- Durable Connection metadata is stored in local SQLite.
- Secrets such as passwords, passphrases, and AI API keys are stored in the OS keychain.
- Update checks are enabled by default and contact KKTerm release metadata only. This is separate from telemetry: KKTerm does not send analytics, crash reports, terminal contents, Connection data, or secrets as part of update checking. When a newer non-draft, non-prerelease release is available, KKTerm prompts the user; it does not install anything without an explicit click.
- Packaged builds normally check `https://kkterm.ryantsai.com/releases/latest.json`, served by the app-owned Cloudflare release mirror, and retain GitHub Releases as fallback. These requests contain no Connection, Session, Tab, terminal, credential, or analytics data.

## Diagnostics Bundle Flow

Diagnostics bundle creation is implemented as a local app command, but the current simplified Settings surface does not expose the diagnostics action. The user-facing diagnostics entry point should be reintroduced only after the Settings UX is redesigned.

The current bundle is a local folder under the app data directory. It includes:

- `README.txt` with sharing guidance.
- `manifest.json` with app version, target OS/architecture, local performance snapshot, last native SSH terminal readiness when measured, and included-file list.
- `kkterm.log` when the local startup log is available.

Debug builds may also create `aiassistant.debug.log`, `mcp.debug.log`, `installer.helper.debug.log`, `url.connection.debug.log`, `rdp.debug.log`, `ssh.debug.log`, `sftp.debug.log`, `telnet.debug.log`, and `kkterm-heartbeat.debug.log` beside `kkterm.log`. Release builds create full AI Assistant, MCP, Install Helper, UI, URL Connection, RDP, SSH, SFTP, Telnet, and heartbeat debug logs only when the user enables **Settings → General → Debug → Advanced Debugging**. Enabling that setting writes an `advanced_debugging.enabled` marker to the JSONL debug logs so the active release logging path is visible immediately; `kkterm-heartbeat.debug.log` starts writing heartbeat lines while the setting remains enabled. These files are not ordinary release telemetry; they are raw local troubleshooting logs for AI Assistant interactions, MCP traffic, Install Helper operations, URL WebView2 overlay geometry, RDP startup/display diagnostics, SSH/SFTP/Telnet transport diagnostics, and frontend/native liveness timing, including provider payloads, stream chunks, tool calls/results, permission blocks, live Session bridge traffic, MCP arguments/results, Dashboard widget creation checkpoints, Install Helper command output, URL hostnames/bounds, RDP hostnames/usernames/options, remote hostnames/usernames, local paths, remote paths, and window/tray timing state. Custom-font UI records are deliberately narrower: they contain sanitized filename stems, parsed face metadata and U+F015 coverage, asset response status/byte count, registered aliases, and load outcome/error class, but omit font paths and exception messages. RDP debug logging defensively redacts password-like, secret-like, token-like, and credential-like fields; SSH, SFTP, and Telnet transport logs omit credential values and terminal/file contents. These files may contain prompts, attached context, terminal buffer text returned through tools, generated widget source, and other user-provided content. Review them carefully before sharing.

The bundle intentionally excludes by default:

- terminal output
- connection passwords and passphrases
- AI API keys
- the SQLite connection database
- known-host material

Users should review the generated files before sharing them. Future diagnostics work may add opt-in selected terminal output or redacted database summaries, but those must remain explicit user actions.

## Bundled Operation Manual

The user-facing operation manual under `docs/manual/` ships with every installer build. Tauri copies each chapter declared in `src-tauri/tauri.conf.json` → `bundle.resources` (mapped to `manual/<filename>.md` in the resource directory). The built-in AI Assistant uses these files as its help/search reference. When a chapter is added or removed, update three places in the same PR: the new/removed `docs/manual/*.md` file, the `bundle.resources` map in `src-tauri/tauri.conf.json`, and the `CHAPTERS` list in `src-tauri/src/manual.rs`. `npm run build` + `cargo check` is sufficient to catch mismatched entries.

## Windows Installer

Create the Windows installer with:

```bash
npm run package:installer
```

The script runs the Tauri NSIS bundle target, copies the generated setup executable to a stable release filename, and writes:

- `artifacts/kkterm-<version>-windows-x64-setup.exe`
- `artifacts/kkterm-<version>-windows-x64-setup.exe.sha256`

The installer uses a current-user install mode by default, creates KKTerm Start Menu entries, and downloads the WebView2 bootstrapper only if the target machine needs WebView2 during install.

### Windows on Arm (ARM64)

Native ARM64 (`aarch64-pc-windows-msvc`) builds ship alongside x64. No feature relies on x64-only APIs at runtime — every native surface uses OS APIs that ship as ARM64 on Windows 11 on Arm — so the work is in the build toolchain and a few arch-aware data paths.

```powershell
npm run package:installer:arm64                      # build (toolchain must be present)
npm run package:installer:arm64 -- -InstallMissing   # also download/install the toolchain
npm run package:installer:arm64 -- -ToolchainOnly    # just check/install toolchain
```

The output is `artifacts/kkterm-<version>-windows-arm64-setup.exe` plus a `.sha256` checksum, matching the x64 script's conventions. Both architectures are built and published together by the **Release** workflow (see "GitHub Release" below); locally, `pwsh scripts/release-github.ps1 -IncludeArm64` adds ARM64 to an x64 release run.

`scripts/package-installer-arm64.ps1` detects each toolchain piece and, with `-InstallMissing`, downloads it via `winget`:

| Piece | Why it's needed | winget id |
| --- | --- | --- |
| Rust target `aarch64-pc-windows-msvc` | compile the app + `kkterm-cli` sidecar for ARM64 | `rustup target add` |
| MSVC **C++ ARM64 build tools** | linker/CRT for the ARM64 target | `Microsoft.VisualStudio.BuildTools` + component `…VC.Tools.ARM64` |
| **C++ Clang Compiler for Windows** | compiles ARM64 assembly used by `ring` / `aws-lc-sys` | VS component `…VC.Llvm.Clang` |
| **CMake** | builds `aws-lc-sys` (rustls' default crypto provider, via `reqwest`/`lettre`) for ARM64 | `Kitware.CMake` |
| **NASM** | `aws-lc-sys` assembly build dependency | `NASM.NASM` |
| Node.js + npm | frontend build (`beforeBuildCommand`) | `OpenJS.NodeJS.LTS` |

The MSVC ARM64 component install is best-effort; if winget cannot add it non-interactively, run the Visual Studio Installer and add **"MSVC Build Tools for ARM64/ARM64EC (Latest)"** and **"C++ Clang Compiler for Windows"**. Cross-building from an x64 host is supported (the script passes `--target aarch64-pc-windows-msvc`); building on an ARM64 host works too.

Runtime notes for the native surfaces: ConPTY, `russh`/`ring`, SChannel, `serial2`, `vnc-rs`, the RDP ActiveX control (`mstscax.dll` ships ARM64), GDI capture, Windows Credential Manager, IP Helper (ARM64 uses a direct `IcmpSendEcho` backend instead of `winping`), tray/single-instance/auto-start, and DWM all run natively. `rustls`/`aws-lc-rs` is native at runtime but needs CMake/NASM at build time. `webviewInstallMode.downloadBootstrapper` auto-selects the ARM64 Evergreen runtime. The NSIS installer executable itself is Tauri's 32-bit x86 stub; it runs under emulation and installs the native ARM64 payload — expected, not a defect.

Feature code that must stay arch-aware:

- **Install Helper `downloadInstaller` fallbacks.** The provider schema accepts optional `arm64Url` / `arm64FileName`. On a native ARM64 build (`cfg!(target_arch = "aarch64")`), `Provider::download_target` prefers the ARM64 asset and otherwise falls back to the x64 asset (which still runs under emulation). `installer/catalog.v1.json` populates native ARM64 downloads where the vendor URL scheme is deterministic (GitHub CLI, VS Code, rustup); `winget` providers already auto-select ARM64. Remaining x64-only entries keep working under emulation and can adopt the same two fields once a native URL is confirmed.
- **AI coding-usage detection.** `src-tauri/src/ai_coding_usage.rs` probes the Codex VS Code extension's per-arch `bin/` folder, preferring `windows-arm64` on an ARM64 build.
- **App-detection registry views.** `src-tauri/src/installer/detect.rs` enumerates the native 64-bit view via `KEY_WOW64_64KEY` (the ARM64 view on Windows on Arm) plus the 32-bit WOW view and matches on the bare uninstall subkey, so native ARM64 installs are detected. The synthetic `ARP\Machine\X64` / `ARP\User\X64` labels are cosmetic; x64 apps installed under emulation that register in a separate emulated view are the remaining edge case to verify on real hardware.

`src-tauri/src/diagnostics.rs` records `target_arch` at runtime, so an ARM64 build self-identifies in diagnostics bundles.

## Windows Portable ZIP

Build the Windows x64 portable package with `npm run package:portable`, or ARM64 with `npm run package:portable:arm64`. Each command writes an architecture-specific ZIP and checksum:

- `artifacts/kkterm-<version>-windows-x64-portable.zip` and `.sha256`
- `artifacts/kkterm-<version>-windows-arm64-portable.zip` and `.sha256`

The ZIP contains the same release executable and Tauri resources as the installer build, `kkterm-cli.exe`, and `kkterm-portable.marker`. It deliberately contains no `data` directory. Portable mode requires an installed Evergreen WebView2 runtime; unlike NSIS, the ZIP cannot bootstrap it during extraction. Run `npm run smoke:portable` after building x64. The smoke test verifies the checksum and archive shape, launches the extracted app in the real Tauri runtime, resolves the bundled manual and Assistant Skills, checks same-root single-instance behavior and clean SQLite exit, and confirms installed storage and KKTerm registry snapshots are unchanged.

Portable update checks use the same trusted metadata but select the exact `windows-<arch>-portable` ZIP/checksum pair. The prompt uses `settings.portableUpdateDownload`; it never launches NSIS. KKTerm downloads and verifies the ZIP, safely stages the known program payload under the portable cache, exits through the native Rust lifecycle, replaces the executable, CLI, manual, and bundled Assistant Skills through a detached handoff, and relaunches. The handoff keeps the existing portable marker, never touches `data`, and restores the previous program payload if the swap or relaunch command fails.

Startup and manual update checks prefer the Cloudflare release mirror and fall back to GitHub Releases. If the release includes the matching Windows installer asset and its `.sha256` checksum, the update dialog offers `settings.updateDownloadAndInstall` ("Download and Install"). That action shows actual byte progress in the shared Status Bar popup. The installer and checksum downloads try the selected host first, then retry the matching asset on the other trusted host (`kkterm.ryantsai.com` or GitHub Releases) if that fetch fails. Cancelling stops the transfer and deletes the partial installer. After download, KKTerm verifies the SHA-256 checksum, holds the popup at 100% for three seconds, starts a detached handoff helper, and exits before the NSIS installer launches so the installed files can be replaced. The helper waits for a successful installer exit, then deletes only that downloaded installer and removes the update directory when empty; failed or cancelled installers remain available for diagnosis or retry. The fallback `settings.updateOpenDownloadPage` action remains available for manual downloads.

TODO: Restore Windows Authenticode signing and the Tauri updater signing flow before treating self-update as fully signed. The current `settings.updateDownloadAndInstall` flow verifies the release checksum over HTTPS/GitHub Releases but does not yet validate a Tauri updater signature or Windows publisher identity. The Tauri updater signature validates self-update artifacts and is distinct from Windows Authenticode signing, which validates publisher identity to Windows.

Smoke test the installer artifact with:

```bash
npm run smoke:installer
```

The smoke test verifies the release artifact checksum, silently installs into a temporary directory, confirms `kkterm.exe` is present and non-empty, then silently uninstalls and removes only the temporary smoke-test directory it created.

## GitHub Release

Publish the next build release with:

```bash
npm run release:github
```

### Cloudflare release mirror

GitHub Releases is canonical, while `kkterm.ryantsai.com` provides resilient update metadata and downloads from the private `kkterm-releases` R2 bucket. The `mirror-release.yml` workflow downloads the complete selected GitHub Release, verifies published SHA-256 pairs, mirrors recognized assets under `releases/v<version>/`, and uploads `releases/latest.json` last. It is safe to rerun for the same tag.

The repository requires `CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN` GitHub Actions secret with permission to write the dedicated R2 bucket. Never commit either value or copy Wrangler's local OAuth credentials into Actions.

Optional Custom Module `.kkmod` payloads are separate catalog artifacts and
must never be added to the KKTerm installer resources. Before publishing a
catalog-enabled build, provide the 32-byte Ed25519 verification public key as
64 lowercase hexadecimal characters in
`KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY`; the private signing key never enters
this repository or the app build. Package hashes, signatures, catalog metadata,
license/notice requirements, and the fixture command are documented in
`docs/CUSTOM_MODULE_PACKAGING.md`.

Windows publishes first. The Windows release script dispatches the mirror immediately; the macOS and Linux scripts dispatch it again after their staggered uploads, allowing the same manifest to gain those signed platform entries later. A daily workflow schedule reconciles the latest stable release if a dispatch was missed.

Retry any failed reconciliation without rebuilding:

```bash
gh workflow run mirror-release.yml --ref main -f tag=v<version>
```

For a local authenticated dry run that performs no R2 writes:

```bash
node scripts/sync-cloudflare-release.mjs --tag v<version> --dry-run
```

The script generates release notes, increments the `<major>.<minor>.<build>` version across npm, Tauri, and Cargo metadata, builds the NSIS installer and matching portable ZIP artifacts, smoke tests both x64 packages, runs frontend and Rust checks, commits the version bump plus release notes, tags it as `v<version>`, pushes to `origin/main`, and creates a GitHub release with their checksums and generated notes. Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-github.ps1 -DryRun` to preview the next version, add `-Draft` for a draft release, or add `-SkipBuild` to publish from existing artifacts.

Release notes are generated before the version-bump commit so the summary covers changes since the previous `v*` tag and not the release commit itself. The generator writes:

- `artifacts/release-notes-v<version>.md` for `gh release create --notes-file`
- `docs/releases/v<version>.md` as the per-version release note
- `CHANGELOG.md` with the newest version prepended

Generated release notes start with a `Direct Downloads` section that links to
the exact GitHub release assets for the generated tag:

- `kkterm-<version>-windows-x64-setup.exe`
- `kkterm-<version>-windows-arm64-setup.exe`
- `kkterm-<version>-windows-x64-portable.zip`
- `kkterm-<version>-windows-arm64-portable.zip`

When `OPENAI_API_KEY` is available, `scripts/generate-release-notes.mjs` asks OpenAI to summarize the GitHub-generated notes and commit context using `gpt-5.4-nano` by default. AI-generated notes are written in English first, followed by a Traditional Chinese (Taiwan) version with the same facts, light humor, and tone. If the key is missing or the API call fails, the script falls back to deterministic notes from GitHub generated notes and commit subjects. Local runs may set secrets in the process environment or in an uncommitted `.env.local` file:

```powershell
$env:OPENAI_API_KEY = "sk-..."
npm run release:github
```

GitHub Actions uses the same scripts through the manual **Release** workflow. The workflow first invokes `scripts/release-github-both-arch.ps1` on Windows so CI/CD increments the version, generates release notes, commits/tags, creates the GitHub Release, and publishes the x64 and ARM64 installers plus portable ZIPs together, matching the local `npm run release:github:both-arch` path. After Windows succeeds, the same workflow runs the macOS release script and then the Linux release script against the newly pushed tag so the complete cross-platform release can be produced from one workflow dispatch. The platform jobs intentionally run in that order to avoid concurrent `latest.json` updates overwriting staggered platform entries. Store the release-notes API key as the repository secret `OPENAI_API_KEY`; the workflow exposes it to the script as the same environment variable. Use the workflow inputs to mark a release as draft/prerelease, skip the Windows package build or smoke tests, disable AI notes, or run a dry preview.

## macOS GitHub Release Assets

macOS builds are attached after the Windows release because they must run on a Mac with Apple signing credentials. The Windows release script remains the canonical version/tag creator. Do not bump versions on the Mac side.

After the Windows release exists, run this on macOS:

```bash
npm run release:github:macos
```

The script builds a single universal (Intel + Apple Silicon) DMG and signed Tauri updater bundle with `npm run package:macos` (`tauri build --target universal-apple-darwin`), copies the user-facing DMG to:

- `artifacts/kkterm-<version>-macos-universal.dmg`
- `artifacts/kkterm-<version>-macos-universal.dmg.sha256`

It also copies the Tauri updater assets and metadata to:

- `artifacts/kkterm-<version>-macos-universal.app.tar.gz`
- `artifacts/kkterm-<version>-macos-universal.app.tar.gz.sig`
- `artifacts/latest.json`

It detects the version from the DMG filename and uses the matching `v<version>` GitHub Release when `--tag` is not supplied. It then notarizes and staples the final renamed DMG, writes the checksum, uploads the macOS files with `gh release upload --clobber`, patches the release notes `Direct Downloads` section with the macOS DMG link, and writes `latest.json` with both `darwin-aarch64` and `darwin-x86_64` updater entries pointing at the same universal bundle. The `latest.json` `notes` field is copied from the current GitHub Release body so the Tauri updater dialog can show the real release notes. Use `--tag v<version>` to force a specific release, `--skip-build` to upload the latest already-built Tauri DMG/updater bundle, `--skip-notes-patch` to leave the release body unchanged, and `--dry-run` to print the resolved version, tag, repository, and artifact names without building or uploading.

The universal build compiles both architecture slices, so the build host must have the `x86_64-apple-darwin` Rust target installed alongside its host target (Apple Silicon machines only ship `aarch64-apple-darwin` by default). Install it once with `rustup target add x86_64-apple-darwin`; `npm run package:macos` checks for it and stops with that hint before invoking Tauri if it is missing. CI installs both targets through the toolchain action.

The macOS build still requires Apple Developer ID signing and notarization environment variables expected by Tauri, such as `APPLE_SIGNING_IDENTITY` plus either App Store Connect API key variables or Apple ID notarization variables. It also requires the Tauri updater private key through `TAURI_SIGNING_PRIVATE_KEY`; `npm run package:macos` reads `TAURI_SIGNING_PRIVATE_KEY_PATH` when the variable is unset, defaults that path to `$HOME/.tauri/kkterm-updater.key`, and base64-wraps a raw Minisign key box if given one (keys generated by `tauri signer generate` are already base64-wrapped and pass through unchanged). A blank-password updater key is supported: the package scripts export `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` when the variable is unset, so the signer does not prompt in CI or release shells. Keep those values in the local shell environment or an uncommitted `.env.local`; never commit Apple certificates, private keys, app-specific passwords, notarization secrets, or updater private keys. The public updater key is committed in `src-tauri/tauri.macos.conf.json`.

## Linux GitHub Release Assets

Linux builds are attached after the Windows release because the Windows release script remains the canonical version/tag creator. Do not bump versions on the Linux side.

After the Windows release exists, run this on Linux:

```bash
npm run release:github:linux
```

On Ubuntu 24.04, the Linux build host must have the Tauri/AppImage native
packages installed: `libwebkit2gtk-4.1-dev libgtk-3-dev
libayatana-appindicator3-dev librsvg2-dev libgbm-dev libssl-dev
build-essential pkg-config libfuse2t64`.

The script builds the x86_64 AppImage with `npm run package:linux`, copies the user-facing AppImage to:

- `artifacts/kkterm-<version>-linux-x86_64.AppImage`
- `artifacts/kkterm-<version>-linux-x86_64.AppImage.sha256`
- `artifacts/kkterm-<version>-linux-x86_64.AppImage.sig`
- `artifacts/latest.json`

It detects the version from the AppImage filename and uses the matching `v<version>` GitHub Release when `--tag` is not supplied. It uploads the Linux files with `gh release upload --clobber`, patches the release notes `Direct Downloads` section with the Linux AppImage link, and writes `latest.json` with a `linux-x86_64` updater entry, merging any existing platform entries so a later Linux or macOS upload does not erase the other platform's updater metadata. The `latest.json` `notes` field is copied from the current GitHub Release body so the Tauri updater dialog can show the real release notes. Use `--tag v<version>` to force a specific release, `--skip-build` to upload the latest already-built AppImage/signature pair, `--skip-notes-patch` to leave the release body unchanged, and `--dry-run` to print the resolved version, tag, repository, and artifact names without building or uploading.

### AppImage-only distribution and its runtime workarounds

Linux distribution is **AppImage-only** by deliberate decision: no `.deb`, `.rpm`, Flatpak, Snap, or distro packages, so the build avoids the libwebkit2gtk/glibc matrix. Ubuntu 24.04 is the build base for AppImage portability, and x86_64 is the only Linux architecture. Linux packaging registers no file associations.

Three AppImage-specific bugs are already fixed in the tree; do not regress them:

- **Bundled Wayland libraries.** linuxdeploy bundles the build host's `libwayland-client.so.0`, `libwayland-egl.so.1`, `libwayland-cursor.so.0`, and `libwayland-server.so.0`. Wayland protocol marshalling must match the *running* machine's Mesa/EGL stack, and the mismatch aborts startup with `Could not create default EGL display: EGL_BAD_PARAMETER`. `scripts/package-linux.sh` extracts the built AppImage, deletes those four `.so` files, repacks with `appimagetool`, and re-signs the updater signature (`tauri signer sign`).
- **WebKitGTK DMA-BUF renderer.** Under some virtualized graphics stacks the DMA-BUF renderer fails silently — the process and `WebKitWebProcess` stay alive but the webview renders nothing. `src-tauri/src/main.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before Tauri/GTK init, gated to Linux and only when `systemd-detect-virt --vm` reports a hypervisor, so bare metal keeps the faster path.
- **AppImage environment leakage.** AppRun exports `LD_LIBRARY_PATH` and GTK/GIO variables pointing into `$APPDIR`. Spawned host processes inherit them and load the bundled Ubuntu libraries on a different distro (the VM detector above failed this way with `libcrypto.so.3: version 'OPENSSL_3.4.0' not found`). `main.rs` scrubs `LD_LIBRARY_PATH` for the detector, and `sessions.rs` scrubs every AppImage-injected variable (`LD_LIBRARY_PATH`, `GTK_*`, `GDK_*`, `GIO_EXTRA_MODULES`, `GSETTINGS_SCHEMA_DIR`, `$APPDIR` entries in `XDG_DATA_DIRS`, `APPDIR`/`APPIMAGE`/`ARGV0`/`OWD`) from local-shell and `ssh` children. `app_launcher.rs` uses the same shared scrub in `linux_env.rs`: exec-bit files run directly, `.desktop` entries launch via `gio launch`, everything else via `xdg-open` with a `gio open` fallback.

A clean-machine AppImage launch — a distro with no development libraries installed — is the real portability gate, since AppImage is the only distribution channel.

The Linux build requires the Tauri updater private key through `TAURI_SIGNING_PRIVATE_KEY`; `npm run package:linux` reads `TAURI_SIGNING_PRIVATE_KEY_PATH` when the variable is unset, defaults that path to `$HOME/.tauri/kkterm-updater.key`, and base64-wraps a raw Minisign key box if given one. A blank-password updater key is supported through the same `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` default described above. Keep the private key and password in the local shell environment or an uncommitted `.env.local`; never commit updater private keys. The public updater key is committed in `src-tauri/tauri.linux.conf.json`.

## Antivirus and EDR Review

KKTerm includes optional network administration tools (ping, TCP port check, port scan, DNS lookup, WHOIS, Wake-on-LAN) for the convenience of network administrators. This section describes what those features do at the OS level so corporate antivirus, EDR, or security teams can review and allowlist them.

When enabled by the user (per-widget opt-in for widget tools), the app may perform:

| Operation | Protocol | Network behavior |
|---|---|---|
| Ping | ICMP (Windows: `IcmpSendEcho2` from `iphlpapi.dll`, same API as `ping.exe`) | Send 1–256 echo requests to a user-specified host with the default TTL. Falls back to a TCP connect on port 80 if ICMP is denied. |
| TCP port check / port scan | TCP | Full three-way handshake to user-specified host/port. Max 1024 ports per call, max 64 concurrent connections, 5 ms inter-connection delay. No SYN scans, no half-open scans, no fingerprinting. |
| DNS lookup | UDP/TCP 53 | Standard DNS query via OS resolver (or Cloudflare/Google fallback if no system resolvers). |
| WHOIS | TCP/43 | Query to `whois.iana.org` and the referred WHOIS server. |
| Wake-on-LAN | UDP/9 broadcast | Send a single magic packet to the broadcast address. |

What KKTerm does **not** do: no raw socket usage on Windows (`IcmpSendEcho2` instead), no SYN/half-open/stealth port scans, no service fingerprinting or OS detection, no automated network discovery on startup, no packet capture (libpcap), and no outbound traffic to attacker-controlled infrastructure.

Two independent settings must both allow a widget network operation before it runs: the widget-level `permissions.networkTools: true` on a specific widget body, and the global "Allow network tools in widgets" toggle in dashboard settings. The widget-level permission is opt-in per widget, so no automated network activity occurs without explicit widget configuration.

Portable ZIPs and self-replacing update flows are commonly scrutinized more than installers. If an AV/EDR flags KKTerm on heuristic port-scan detection during an authorized scan, allowlist the verified release hash: every installer and portable ZIP has its own published `.sha256`, so verify the exact downloaded artifact rather than allowlisting a folder. Restoring Authenticode signing remains a release goal (see "Known Limitations"). Report false positives through the project issue tracker.

The portable ZIP is not a sandbox. KKTerm-owned state stays in its sibling `data` folder, while explicit actions such as Install Helper installs, managed web apps, OS-keychain use, or external MCP configuration can change the current machine. Extract the ZIP before scanning or launching it; do not remove `kkterm-portable.marker`, which is the mode boundary that prevents installed-path fallback.

## Known Limitations

- Windows, macOS, and Linux are supported release targets. macOS DMG and Linux AppImage publishing are currently attached as follow-up asset uploads to an existing GitHub Release.
- The Windows installer build and smoke test are repeatable, but the installer is unsigned until release signing is configured.
- SSH readiness performance is instrumented for native post-auth terminal setup and retained in local performance snapshots after a native SSH Session starts. The repeatable `npm run measure:ssh-readiness` helper can validate the `<= 150 ms` budget against a trusted non-`ProxyJump` SSH Connection, but the latest documented run still lacks a measured value because valid SSH auth was not available in the measurement environment.
- Native SSH-launched SFTP does not support `ProxyJump`; SSH terminal sessions with `ProxyJump` use the system `ssh` fallback/debug path where available.
- SSH config import support exists behind the local command boundary, but the current Settings surface does not expose a user-facing import action. The same applies to the diagnostics bundle action.
- SFTP supports recursive file and folder transfer, multi-select drag/drop, overwrite prompts with overwrite-all handling, clearable finished transfer history, remote properties, chmod, and chown, but folder sync, diff/compare, transfer resume, archive/extract, and remote file editing remain deferred.
- Screenshot capture is available from terminal Pane toolbars and non-terminal workspace top toolbars. Region and Entire Window/Panel captures can be copied to the system clipboard or attached transiently to the AI Assistant through explicit user action.
- RDP uses the Windows ActiveX host and VNC uses a canvas-rendered `vnc-rs` framebuffer path; advanced VNC options, richer clipboard handling, sync, and team sharing remain deferred.
- AI command assistance and app tool use are bounded by assistant tool settings. Prompt mode is the default and blocks mutating tools with a permission-required result; Allow All is an explicit setting that lets enabled tools execute automatically. The Assistant can use typed tools for Dashboard changes, saved Connection management, and active Session interaction, but it should not be treated as an unattended autonomous operator.
- Settings exposes General, Appearance, Dashboard, Workspace, Install Helper, Credentials/MCP, AI Assistant, SSH, Terminal, URL, RDP, VNC, and About sections. SSH config import and editable keybindings are not yet exposed.
- Diagnostics bundles are folders, not compressed archives.

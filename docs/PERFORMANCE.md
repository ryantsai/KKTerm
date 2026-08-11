# KKTerm Performance and Terminal Compatibility Checks

KKTerm performance checks are local-only. They use manual observation, diagnostics snapshots, scripts, and local process memory data; they do not upload telemetry and they should not capture terminal contents.

The app-wide Status Bar is no longer a performance-budget readout. It remains visible across all Modules and pages, with a Module-owned left segment and a universal center notifications text area. It is intentionally reserved for:

- low-frequency host usage metrics in the Workspace Module, sampled about every 5 seconds. CPU uses `GetSystemTimes`, RAM uses `GlobalMemoryStatusEx` with `GetPerformanceInfo` fallback, and downstream/upstream network transfer rates use the IP Helper interface table with Status Bar display rounded to MB/s.
- transient Status Bar notices, such as SSH public key transfer success, which appear in the center notifications text area and disappear after a short timeout

Do not add debug-only timing indicators back to the Status Bar. Use diagnostics, logs, DevTools, measurement scripts, or a purpose-built debug build when validating budgets.

## Budgets

| Metric | Budget | Source |
| --- | ---: | --- |
| Cold launch to usable UI | <= 1,000 ms acceptable, <= 500 ms target | Release-measurement run or DevTools/performance instrumentation |
| New local terminal tab ready | <= 100 ms | Release-measurement run or explicit local terminal timing instrumentation |
| SSH terminal ready after auth | <= 150 ms, excluding network/auth wait | `npm run measure:ssh-readiness`, diagnostics snapshot, or release-measurement run |
| Idle memory | <= 150 MiB target | Diagnostics snapshot or OS process working-set/private-bytes counters |

## Measurement Run

Use a release-like Tauri build when possible. Development builds are still useful for regressions, but record that they are development measurements.

1. Start KKTerm and wait until the first workspace is usable.
2. Record cold launch timing from the release-measurement harness, DevTools, or another explicit timing source.
3. Let the app sit idle for at least 30 seconds with no active transfers.
4. Record memory from diagnostics, Task Manager, Process Explorer, or equivalent local OS counters.
5. Open a new local terminal tab.
6. Record local terminal readiness from explicit timing instrumentation.
7. Open a native non-`ProxyJump` SSH Connection that has already completed host-key trust.
8. Record SSH readiness with `npm run measure:ssh-readiness` or diagnostics after authentication completes. The value is measured in the Rust SSH path after verified connect/auth returns and covers terminal channel, PTY, shell, and initial directory setup.

Record the machine, OS, build type, date, and values in release notes or the validating issue before marking a milestone measurement item complete.

## Blocking-command Review Checklist

Use this checklist whenever a new Tauri command is added or an existing command gains more work. A function being short is not evidence that it is cheap; inspect the helpers it calls.

1. Classify the worst case, not the typical development fixture. Treat directory/database scans, per-entry metadata, full-file work, image conversion, compression/extraction, password KDFs or bulk cryptography, registry scans, synchronous network calls, and child-process waits as blocking.
2. Keep only provably bounded validation and short in-memory synchronization in a synchronous command. Move blocking synchronous helpers immediately into `run_blocking_command`/`spawn_blocking`, or use a pure async implementation end to end.
3. Keep native owner-thread work minimal. Split CPU, delay, and I/O phases away from the native UI phase when the platform API itself cannot move.
4. Audit concurrency introduced by the new boundary. Preserve serialization for shared native UI and mutable database/filesystem resources; protect changing paths, Connections, Sessions, queries, pages, and selections with a generation/request token or equivalent current-target check so late results cannot replace newer state.
5. Preserve IPC payloads, errors, side-effect ordering, cancellation behavior, and progress reporting. Offloading is not permission to change product behavior.
6. Add a structural regression test that keeps known-expensive commands asynchronous and verifies the blocking boundary, plus a caller-level test when result ordering matters.
7. Run the smallest relevant tests and `cargo check`; use a release-like Tauri build and real low-end hardware or constrained CPU profiling for claims beyond command-boundary correctness.

The canonical runtime rules and approved command shapes live in `docs/ARCHITECTURE.md` under **Backend Command Runtime Boundaries**.

The last native SSH post-auth readiness value is kept in the local performance snapshot and diagnostics manifest as `lastSshTerminalReadyMs`, with no Connection name, host, terminal output, or secret material.

For repeatable SSH readiness checks without terminal output capture, use the ignored Rust measurement test through the package script:

```powershell
$env:KKTERM_SSH_HOST = "example.internal"
$env:KKTERM_SSH_USER = "admin"
$env:KKTERM_SSH_AUTH = "agent" # or keyFile/password
$env:KKTERM_SSH_KEY_PATH = "C:\Users\you\.ssh\id_ed25519" # keyFile only
$env:KKTERM_SSH_PASSWORD = "..." # password only; not printed by the script
$env:KKTERM_SSH_KNOWN_HOSTS_PATH = "$env:APPDATA\com.kkterm.app\ssh_known_hosts"
npm run measure:ssh-readiness
```

The helper opens the native `russh` terminal path, starts timing only after verified connect/auth completes, asserts the `<= 150 ms` budget, prints the measured duration, and does not print host output or secret values.

## Latest Measurement

Measured on 2026-05-02 11:50:35 +08:00 using the release executable built at `src-tauri/target/release/kkterm.exe`. The Tauri bundler did not complete because the WiX download timed out, so this run uses the built release executable directly rather than an installed MSI.

### System Specs

| Component | Value |
| --- | --- |
| OS | Microsoft Windows 11 Pro 10.0.26200, 64-bit |
| Machine | Micro-Star International Co., Ltd. MS-7E47, x64-based PC |
| BIOS | American Megatrends International, LLC. 1.A77, 2025-09-10 |
| CPU | AMD Ryzen 9 9950X3D 16-Core Processor, 16 cores / 32 logical processors, 4.3 GHz max clock |
| Memory | 64 GiB installed, 2 x 32 GiB Micron CT32G56C46U5.C16B2 DDR5 at 5600 MT/s |
| GPU | NVIDIA GeForce RTX 5080, driver 32.0.15.9636; AMD Radeon(TM) Graphics, driver 32.0.21043.5001; SudoMaker Virtual Display Adapter, driver 1.10.9.289 |
| Storage | AMD-RAID Array 2 SCSI Disk Device, 2.05 TB; AMD-RAID Array 1 SCSI Disk Device, 2.00 TB |
| Toolchain | Node v22.16.0, npm 10.9.2, rustc 1.93.1, cargo 1.93.1 |

### Results

| Metric | Measurement | Budget | Status | Notes |
| --- | ---: | ---: | --- | --- |
| Cold launch to usable UI | 71 ms | <= 1,000 ms acceptable, <= 500 ms target | Pass | Historical measurement from the previous app chrome `UI ready` status value. External WebView2 CDP page availability was 247 ms. New runs should use explicit timing instrumentation because the Status Bar no longer shows this value. |
| Idle memory | 27.9 MiB | <= 150 MiB target | Pass | Historical measurement from the previous app chrome `Memory` status value after 30 seconds idle. Process working set was 27.9 MiB and private bytes were 5.0 MiB. New runs should use diagnostics or OS process counters. |
| Idle CPU | 0.000% | No formal budget | Informational | CPU delta over the 30 second idle window, normalized across 32 logical processors. |
| New local terminal tab ready | 16 ms | <= 100 ms | Pass | Historical measurement from the previous app chrome `Local ready` value after triggering the `New local terminal` button in the release app. New runs should use explicit timing instrumentation. |
| Working set after one local terminal | 29.4 MiB | No separate budget | Informational | Process private bytes were 6.5 MiB. Shell child-process memory is not included in this app-process value. |
| Release executable size | 16.9 MiB | Not Electron-scale | Pass | Size of `src-tauri/target/release/kkterm.exe`. |
| SSH terminal ready after auth | Not measured | <= 150 ms excluding network/auth | Pending | The app records native SSH post-auth terminal readiness in performance snapshots and diagnostics manifests, and the repeatable `npm run measure:ssh-readiness` helper can measure it directly. This run still requires a non-`ProxyJump` SSH Connection with host key already trusted and valid auth available in the measurement environment. |

This run meets every measured performance budget. SSH readiness remains the only documented performance budget not validated by this run.

## Terminal Glyph Renderer

Terminal panes use `xterm.js` with the `@xterm/addon-webgl` GPU glyph renderer attached opportunistically. The addon is loaded after `Terminal.open()` in `src/modules/workspace/connections/terminal/renderer.ts`; if WebGL2 is unavailable (driver blocklist, headless RDP, virtualized GPU) the renderer silently stays on the xterm DOM renderer. On `onContextLoss` (sleep/wake, GPU reset) the addon is disposed and xterm falls back to the DOM renderer for subsequent frames without tearing down the Session.

WebGL is the expected fast path on the supported hardware. Validate it during a release-like measurement run by:

1. Open a local terminal Session.
2. In DevTools (or a temporary debug build), confirm the pane host element contains a child `<canvas>` rendered by the WebGL addon.
3. Run a noisy command such as `for /l %i in (1,1,200000) do @echo %i` (cmd) or `seq 1 200000` (Unix shell over SSH) and verify the pane stays responsive and CPU on the renderer process stays well below the DOM-renderer baseline.

If WebGL is not active, record this in the run notes; the budgets in this document apply to the DOM-renderer fallback as well, and no budget is loosened by the absence of GPU rendering.

## SSH Idle Behavior

Native SSH terminal Sessions do not use an app-side inactivity timeout. Idle performance runs may leave SSH Panes quiet and unfocused without expecting KKTerm to disconnect them. If a tmux-enabled native SSH channel unexpectedly closes after startup, KKTerm attempts a small bounded silent reattach to the same locale-generated Pane tmux session id. Server-side SSH idle policies, firewall idle reaping, sleep/resume, and network drops remain external causes and should be recorded separately from app CPU or memory measurements.

## Terminal Compatibility Smoke Scenarios

The quick scenarios below are the smoke pass. The full manual checklist is the last section of this document. Run either in a local terminal and, where practical, in a native SSH terminal. Keep terminal output private unless a user explicitly chooses to include selected text in diagnostics.

| Scenario | Expected Result |
| --- | --- |
| `vim` or `nvim` opens, edits, saves, and exits | Alternate screen restores the shell prompt cleanly |
| `tmux` starts, splits panes, switches panes, and exits | Mouse and resize behavior remain usable |
| Native SSH stays idle while unfocused or minimized | Session remains usable after returning to the app |
| tmux-backed native SSH transport recovers after a short break | Pane reattaches to the same locale-generated tmux session id within the bounded retry window |
| `htop` or `btop` runs | Full-screen redraws are stable and input remains responsive |
| `git status`, `git log`, and pager navigation | Scroll, search, and quit behavior match normal terminal expectations |
| Search terminal scrollback from a pane | Matches are highlighted, next/previous navigation wraps through scrollback, and closing search clears decorations |
| `npm run check` or similar noisy command | Scrollback remains available and terminal stays responsive |
| `cargo test` or similar long command | Output does not corrupt after resize |
| Paste a multi-line command while confirmation is enabled | User confirmation appears before input is sent |
| Paste into an app that enables bracketed paste, such as a shell/readline or editor | Pasted text is bracket-delimited by the terminal app when supported |

If a scenario fails, note whether it is renderer behavior, shell/application behavior, SSH transport behavior, or an app layout/resize problem before changing the renderer abstraction.

For RDP-specific gray gutters or a short resize after switching Tabs, check app layout before changing RDP resize logic. The right AI Assistant panel and other chrome must keep one global width/collapsed state across Tabs. If those dimensions change on Tab activation, the RDP ActiveX HWND is being resized by the workspace and the symptom can look like a remote desktop display-size failure even when the RDP Session is healthy.

For RDP-specific overlay bugs, remember that ActiveX is a native child HWND and may cover React UI even when the DOM has a higher `z-index`. CSS stacking, React portals, and ordinary DOM reparenting do not solve this RDP class of bug. Simple text command menus should use `src/lib/nativeContextMenu.ts`; Quick Connect, Add Connection, Connection Tree context menus, Activity Rail Connection context menus, Tab context menus, and screenshot toolbar menus must not be added to RDP overlay parking. The expected RDP-only behavior for real DOM overlays is geometry-scoped snapshot/parking: when a registered overlay intersects the active RDP host, the frontend captures the RDP host as a transient bitmap, hides/parks the ActiveX HWND, and shows the bitmap beneath the overlay. If a dialog or Region overlay is covered by RDP, first check whether its selector is registered in `src/modules/workspace/nativeOverlay.ts`, then confirm the overlay rectangle intersects the `remote-desktop-workspace` bounds before changing z-index, portal placement, or RDP sizing logic. Do not apply RDP screenshot parking to terminal, VNC, SFTP, or URL/WebView2 workspaces. URL Connections use stable owned `WebviewWindow` overlays and should hide/dim the overlay for proven blocking DOM overlays instead of reusing the RDP bitmap path. If snapshot/parking is not acceptable for a future RDP interaction, treat the work as a native overlay/rendering architecture change rather than a CSS fix: viable directions are native popup/owned HWND overlays, region clipping around the RDP host, or a non-ActiveX RDP renderer.

## Manual Terminal Compatibility Checklist

Run this checklist before signing off terminal-affecting work: vim, tmux,
htop/btop, git, npm, cargo, and Pane scrollback search. Run it in a local
terminal Session; if a trusted native SSH Connection is available, repeat the
same checks there. Do not include terminal output in diagnostics or release
notes unless the user explicitly selected and shared it.

Run the checklist in a local terminal Session. If you have a trusted native SSH Connection available, repeat the same checks there as well. Do not include terminal output in diagnostics or release notes unless the user explicitly selected and shared it.

### Test Run Metadata

Record these values with the completed checklist:

| Field | Value |
| --- | --- |
| Date | |
| KKTerm build or commit | |
| Windows version | |
| Shell | PowerShell / cmd / Git Bash / WSL / other |
| Session type | Local / native SSH |
| SSH transport, if used | Native non-ProxyJump / system ssh fallback |
| SSH tmux mode, if used | Enabled / disabled / tmux not installed |
| tmux session id, if used | |
| Terminal font and size | |
| Scrollback setting | |
| Glyph renderer in use | WebGL / DOM fallback (inspect pane host element for an addon `<canvas>` child) |

### Pass Criteria

The checklist passes when:

- Full-screen terminal apps use the alternate screen cleanly and restore the prompt after exit.
- Keyboard input, paste, Ctrl+C, Escape, arrows, function keys, and common modifier shortcuts are delivered correctly.
- Returning to KKTerm from another Windows app restores keyboard input to the focused visible terminal Pane without an extra click.
- Mouse interactions work in apps that enable mouse support.
- Terminal resizes propagate to running apps without corrupted layout.
- Long command output remains responsive and searchable in the correct Pane.
- Quiet, unfocused native SSH Sessions remain connected while the app is minimized or in the background unless the remote server, network, or explicit user close ends them.
- tmux-backed native SSH Sessions recover from a short unexpected transport break by reattaching to the same Pane tmux session id within the bounded retry window.
- Scrollback search decorations, navigation, and close behavior do not interfere with terminal input.

### Setup Checks

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Open baseline local terminal | Open a new local terminal tab. Run `echo $PSVersionTable.PSVersion` in PowerShell or `echo %COMSPEC%` in cmd. | Prompt accepts input and output appears without layout shifts. | |
| Open optional SSH terminal | Open a trusted native SSH Connection if available. | Session reaches a prompt and resize/status behavior remains normal. | |
| Open tmux-enabled SSH terminal | Open an SSH Connection with `Use tmux sessions` enabled. | The Pane toolbar shows a `tmux` session tag before other Pane actions. The remote shell attaches to or creates the named tmux session when tmux is installed. | |
| Open SSH terminal without remote tmux | Open a tmux-enabled SSH Connection to a host where `tmux` is not installed, or temporarily make `tmux` unavailable on a test host. | KKTerm falls back to the normal remote shell and the terminal remains usable. | |
| Switch tabs without disconnecting | Open two terminal tabs. Run a long-lived safe command or leave a prompt active in the first tab, switch to the second tab, then switch back. Repeat with native SSH when available. | The first Session remains connected and usable after tab switches. No disconnect occurs unless the tab-strip close `X` is explicitly pressed or the process/remote host ends the Session. | |
| Minimize/background idle SSH | Open a native SSH terminal and leave it idle at a prompt. Minimize KKTerm or switch to another app for at least 2 minutes, then return. | The SSH Session remains connected and usable. For tmux-enabled Panes, the Pane should still be attached to the same locale-generated tmux session id. | |
| Restore focus after app switch | Open a single native SSH terminal Tab and leave it at a prompt. Switch to Chrome or another Windows app, then switch back to KKTerm without clicking inside the terminal. Type a harmless character or command such as `echo focus-check`. | Keyboard input goes to the focused visible terminal Pane immediately. No click inside the Pane is required after returning to KKTerm. | |
| Split terminal panes | Split the terminal tab into at least two Panes. Run a different command in each Pane. | Focus, typing, and output stay isolated to the active Pane. | |
| Resize app window | Resize the KKTerm window while a prompt is visible. | Prompt redraws cleanly, with no duplicated prompt fragments or stale rows. | |

### vim or nvim

Use `vim` or `nvim`; if neither is installed, record `Not installed` and skip the app-specific checks.

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Alternate screen entry and exit | Run `vim` or `nvim`, then `:q`. | Editor opens full-screen and exits back to the original shell view cleanly. | |
| Edit and save | Open a temporary file, enter insert mode, type several lines, save with `:w`, then exit. | Insert mode, status line, command line, and saved file behavior are normal. | |
| Arrow and Escape keys | Move around with arrows, enter insert mode, press Escape, then navigate again. | Mode changes and cursor movement are correct. | |
| Resize while open | Resize the KKTerm window while the editor is open. | Editor redraws to the new dimensions without visual corruption. | |
| Paste behavior | Paste multiple lines into insert mode. | Paste is inserted as text, not executed by the shell, and indentation is not unexpectedly mangled by terminal handling. | |

### tmux

If `tmux` is unavailable on the local shell, run this section in SSH or record `Not installed`.

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Start and exit | Run `tmux`, then exit with `exit` or detach/kill the test session. | tmux starts full-screen and returns to the shell cleanly. | |
| Split panes | In tmux, create horizontal and vertical splits. | tmux panes render with correct borders and no stale text. | |
| Switch panes | Move focus between tmux panes using the configured tmux prefix shortcuts. | Input goes to the selected tmux pane only. | |
| Resize propagation | Resize the KKTerm window while tmux is open. | tmux recalculates layout correctly. | |
| Mouse mode | Use an KKTerm-launched tmux SSH Pane or enable tmux mouse mode, then click panes and scroll. | tmux mouse focus and internal scrollback behavior work; a native xterm scrollbar is not expected while tmux owns the alternate buffer. | |

### SSH tmux Resume

Run these checks against a trusted SSH Connection. If the remote host has no `tmux`, run the fallback check and record `Not installed`.

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Default setting | Create a new SSH Connection. | `Use tmux sessions` is enabled by default. | |
| Pane session tag | Open the SSH Connection. | Each terminal Pane toolbar shows its tmux session id to the left of the Pane actions. | |
| Resume same Pane session | In a tmux-enabled Pane, run a safe long-lived command or create a tmux window, close the KKTerm Tab, then reopen the same Connection. | The Pane attaches to the same named tmux session and the remote tmux state is still present. | |
| Child Connection Tab tmux resume | Enable `settings.hideTopTabButtons`, open a tmux-enabled SSH Connection through `workspace.newTab`, then close and relaunch KKTerm. Click the Child Connection Tab row under the parent Connection. | The row name defaults to the tmux session id, no SSH Session starts until the row is clicked, and the reopened Pane attaches to the same tmux session id. | |
| Child Connection Tab non-tmux directory resume | Enable `settings.hideTopTabButtons`, open a non-tmux terminal child, change directory, close and relaunch KKTerm, then click the Child Connection Tab row. | The row is restored without connecting at startup, and reopening starts in the last reported working directory when the shell emits OSC 7 directory updates. | |
| Child Connection Tab parent layout | With two or more Child Connection Tabs under one parent Connection, click the parent Connection row. | KKTerm opens the children together in one split Tab: two children side-by-side, three as two above one, and larger counts in a grid-style layout. | |
| Child Connection Tab parent focus restore | With many Child Connection Tabs open in a parent split layout, focus a middle child Pane, switch to another Module or Connection, then click the parent Connection row again. | KKTerm shows the full parent split layout, keeps the previously focused child Pane active, and terminal input returns to that Pane. | |
| Recover after idle transport close | In a tmux-enabled native SSH Pane, simulate or wait for a transient transport close, then return to the Pane. | KKTerm silently attempts the bounded reattach and the Pane returns to the same tmux session id. If the retry window is exhausted, the failure remains quiet after startup and no unrelated Sessions are closed. | |
| Split Pane session ids | Split the SSH terminal into at least two Panes. | Each Pane gets a distinct tmux session id and input stays isolated to the active Pane. | |
| List tmux sessions | Click the tmux session tag. | The popover lists remote tmux sessions and clearly marks attached vs detached sessions. | |
| Close tmux session | In the tmux session popover, close a detached test session with the `X` button. | The remote tmux session is killed and the list refreshes without closing unrelated terminal Sessions. | |
| Missing tmux fallback | Open a tmux-enabled SSH Connection where `tmux` is unavailable. | The terminal starts a normal interactive shell rather than failing the SSH Session. | |

### htop or btop

Use whichever is installed. If both are installed, prefer running both.

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Full-screen redraw | Run `htop` or `btop`. | Screen updates continuously without flicker severe enough to impair use. | |
| Keyboard navigation | Use arrows/PageUp/PageDown or app-specific navigation. | Selection and scrolling respond normally. | |
| Mouse interaction | Click rows or controls if the app supports mouse input. | Clicks are delivered accurately. | |
| Resize while active | Resize the KKTerm window. | Layout redraws without broken columns or stale regions. | |
| Exit restore | Quit the app. | Original shell prompt is restored cleanly. | |

### git and Pager Behavior

Run these checks inside a Git repository.

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Status output | Run `git status --short`. | Output renders normally and prompt returns. | |
| Log pager | Run `git log --oneline --decorate --graph -n 30`. Navigate with arrows/PageUp/PageDown and quit with `q`. | Pager navigation and quit behavior match a normal terminal. | |
| Diff colors | Run `git diff --stat` and, if available, `git diff`. | Color and wrapping are readable; pager does not corrupt the prompt after quit. | |
| Search in pager | In `git log`, search for text with `/`, step through matches, then quit. | Search highlighting and navigation work inside the pager. | |
| Ctrl+C handling | Run a safe long command such as `git status --ignored` in a large repo if available, then press Ctrl+C. | Command interrupts and terminal remains usable. | |

### npm

Run these checks in a Node project.

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Noisy command output | Run `npm run check` or another project check script. | Streaming output remains responsive and readable. | |
| Long output scrollback | Run a command that prints enough lines to fill scrollback, such as a verbose test or build. | Scrollback remains available after the command completes. | |
| Interactive interrupt | Start a long-running script such as a dev server, then press Ctrl+C. | Process receives interrupt and returns to the prompt. | |
| Resize during output | Resize the window while npm output is streaming. | New output uses the new terminal width without corrupting existing visible rows. | |
| Multiline paste confirmation | Paste a multi-line command while confirmation is enabled. | KKTerm prompts before sending the paste to the Session. | |

### cargo

Run these checks in a Rust project.

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Build/check output | Run `cargo check`. | Progress and compiler output render correctly. | |
| Test output | Run `cargo test`. | Test status lines render correctly and prompt returns. | |
| Colored diagnostics | Trigger or inspect colored compiler/test output if available. | ANSI color and formatting are readable and do not leak escape text. | |
| Long command interrupt | Run a safe long command, then press Ctrl+C. | Process interrupts and the Session remains usable. | |
| Resize during cargo output | Resize the KKTerm window while cargo is running. | Output continues without prompt or line corruption. | |

### Pane Scrollback Search

Run these checks after generating substantial output in at least two Panes.

| Check | Steps | Expected Result | Result |
| --- | --- | --- | --- |
| Open search in active Pane | Focus a Pane and open terminal scrollback search. Search for text known to exist in that Pane. | Matches are highlighted only in the focused Pane. | |
| Next and previous match | Use next and previous controls across multiple matches. | Navigation moves through matches in order and remains visually aligned. | |
| Wrap behavior | Navigate past the last and first match. | Search wraps through scrollback without losing the query. | |
| No-match state | Search for text that does not exist. | UI communicates no match without changing terminal contents. | |
| Close search | Close the search control. | Search highlights/decorations clear and keyboard focus returns to terminal input. | |
| Search after command output | Run another command after closing search, then search for new output. | New output is searchable and old decorations do not reappear. | |
| Pane isolation | Search in one Pane, then focus another Pane and search for different text. | Search state and highlights do not bleed across Panes. | |

### Native Menu Regression Check

Simple Workspace command menus must be native Tauri context menus in the desktop runtime, not DOM flyouts that force WebView2 or terminal visibility changes. Check Quick Connect, Add Connection, right-click on empty Connection Tree space, right-click on a Connection, right-click on a pinned/connected Activity Rail Connection, right-click on a workspace Tab, and the screenshot toolbar menu on URL/RDP/VNC workspaces. Opening these menus should not blank, hide, resize, or park WebView2, terminal, SFTP, or VNC surfaces. RDP ActiveX parking is reserved for registered DOM overlays such as Region selection or dialogs that actually intersect the RDP host.

Native context menu icons should appear beside command items. Connection items should match the original Connection Tree/Rail PNG or URL favicon image; command-only actions should use app-owned line-icon-style SVG strings from `src/lib/nativeMenuIcons.ts`. Image sources are rasterized to 16px PNG bytes by `src/lib/nativeContextMenu.ts`, converted with Tauri `Image.fromBytes`, and attached through explicit Tauri `IconMenuItem`s. On macOS, every command-only `nativeMenuIcons` entry must map to a Tauri `NativeIcon` template image through `macosTemplateNativeIconsBySvg` so the icon follows the native menu text color when selected or disabled; use the closest alternative template icon when AppKit has no exact match. Keep `tests/native-context-menu-tauri-shape.test.mjs` updated so new command icons cannot silently fall back to fixed-color PNGs. Keep `image-png` enabled in `src-tauri/Cargo.toml`; missing icons should be fixed through that shared adapter/model and Cargo feature path, not by replacing native menus with DOM flyouts.

### Known Protocol Gaps

- **Kitty keyboard protocol (progressive keyboard enhancement / CSI u)**: xterm.js does not implement it, so TUIs that probe for it (Helix, newer Neovim configurations, kitty-native tools) fall back to legacy key encoding. Expect degraded modifier-combination support in those apps; this is an upstream renderer limitation tracked on the roadmap alongside the WGPU renderer evaluation, not a KKTerm regression.

### Notes for Failures

For each failure, record:

- Session type: local terminal, native SSH terminal, or system ssh fallback.
- Shell and app under test.
- Whether the issue appears tied to input, rendering, scrollback, resize, alternate screen, bracketed paste, mouse, or transport.
- Exact high-level reproduction steps, without copying private terminal output unless explicitly approved.
- Whether the issue reproduces after opening a fresh Tab or Pane.

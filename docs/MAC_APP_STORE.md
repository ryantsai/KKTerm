# Mac App Store file access and packaging

The `mac-app-store` Cargo feature is opt-in and macOS-only. The normal
`npm run package:macos` command does not enable it. Store behavior is compiled
into the executable and reported by `get_app_mode.macAppStoreBuild`; it is not
selected by an environment variable at runtime or by a Store receipt.

## Build

Set `APPLE_SIGNING_IDENTITY` to the App Store application signing identity and
`KKTERM_APP_STORE_PROVISION_PROFILE` to the matching provisioning profile path.
Install both Rust macOS targets, then run:

```sh
npm run package:macos:app-store
```

The command builds a universal app with `tauri.appstore.conf.json`, embeds the
profile, and checks the signed app's entitlements. The Store overlay pairs
`mac-app-store` with `Entitlements.appstore.plist` and disables updater artifacts.
The compiled Store flag also disables automatic update checks before a receipt
is installed. Package/sign the resulting app for App Store submission using the
distribution team's existing installer-signing/upload process; this script
does not upload a build or submit it for review.

The file-access entitlement is `com.apple.security.files.user-selected.read-write`.
There is no blanket Downloads or USB entitlement. The serial entitlement covers
Serial Connections; the incoming-network entitlement covers SSH forwarding and
the built-in MCP listener. Audit the final signed binary when changing these
features. Also verify helper/sidecar sandbox inheritance in the signed package.

For local compilation without distribution credentials:

```sh
cargo check --manifest-path src-tauri/Cargo.toml --features mac-app-store
```

This compilation alone does not sign or sandbox the executable.

## Sandbox behavior differences

The App Sandbox rewrites `$HOME` to the app container and denies the real home
folder, `~/Pictures`, `~/Downloads`, `~/Desktop`, `/etc`, `/tmp`, and Homebrew
prefixes. Child processes inherit the sandbox, so a spawned shell or helper is
confined exactly as the app is. These were measured against a binary signed with
`Entitlements.appstore.plist`, not inferred. Everything below is gated on
`app_store_files::ENABLED` (Rust) or `isMacAppStoreBuild()` / `useMacAppStoreBuild()`
(frontend); no other build changes behavior.

- **Stored path grants.** A path in Settings or on a Connection is only a hint
  until its security-scoped bookmark is re-opened. `Storage::configured_local_paths`
  collects them and startup calls `app_store_files::activate_path` for each, which
  keeps the grant open for the process. `sessions.rs` additionally activates a
  Connection's `key_path` before `load_secret_key` reads it, so SSH key auth
  survives a relaunch. Every selector whose result is persisted routes through
  `selectPersistentPath` in `src/lib/tauri.ts`.
- **Screenshots folder.** `default_screenshot_folder_path` returns a folder inside
  the container instead of `~/Pictures/Screenshots`, which the sandbox denies.
- **SFTP local pane.** `default_local_directory` starts in the container's
  Documents folder, and `is_listable_place` hides Places entries the sandbox
  cannot read (the container's Desktop/Downloads/Pictures symlinks answer
  `is_dir()` but deny every read).
- **Video recording.** `resolve_ffmpeg` returns `None`: Homebrew and `/usr/local`
  are unreachable and macOS has no Install Helper. The Screenshots Module hides
  the media picker and the video-format setting.
- **Shutdown timer.** `ShutdownTimerManager::schedule` refuses, and the schedule
  menu is not offered. macOS shutdown needs a System Events Apple event, which
  requires `com.apple.security.automation.apple-events`; the Store build does not
  carry it, and a shutdown feature invites App Review scrutiny.
- **Local shell Sessions.** Confined by inheritance, with no workaround: the
  user's dotfiles, `/etc/paths`, and Homebrew tools are unreadable. Documented in
  manual chapter 5.
- **Built-in MCP bridge.** The socket lives in the container, so a sandboxed
  external client cannot reach it. Unsandboxed clients are unaffected. See
  `docs/MCP.md`.
- **ICMP ping.** Raw ICMP sockets are denied; `net/ping.rs` already falls back to
  a TCP reachability probe and reports `mode: "tcp"`. Datagram ICMP is permitted,
  so a future `sock_type_hint` change could restore true ping.
- **Screen Recording TCC.** A Mac that previously ran a direct-download build
  holds a Privacy & Security entry recorded against that build's Developer ID
  requirement. The Store build cannot match it and re-prompts forever even though
  the toggle appears enabled. Removing the entry with **−** and re-approving fixes
  it; `tccutil reset ScreenCapture com.kkterm.app` does the same from a terminal.

## Signed desktop acceptance checks

Use a clean test installation of the signed, sandboxed Store variant. A normal
development build or standalone browser preview does not prove sandbox access.

1. Add a Dashboard App Launcher folder using its native picker; launch it, quit,
   reopen, and launch it again without another picker.
2. Drop a Finder folder, multiple folders, and a file onto the launcher. Verify
   each accepted item works after relaunch. A drop source that does not grant
   access must fall back to native selection; canceled items must not be added.
3. Import an entry or type a path outside the container. Verify native selection
   is required before first use and canceling does not launch it.
4. Move/rename a selected folder. Verify bookmark resolution follows it. Unmount
   and reconnect an external volume, then check access and reselection recovery.
5. Open a URL Connection with an empty download-folder setting. No picker or
   filesystem write should occur on Session startup. Start a download, select a
   destination, and verify the completed file. Repeat after restarting KKTerm.
6. Cancel first-download selection: no file is written and no fallback destination
   is used. Change Settings' download folder and verify the next URL Session uses
   that selection. Test simultaneous downloads and unavailable destinations.
7. Repeat launcher and download basics with the ordinary macOS build. It must
   retain its existing behavior and never request Store bookmark authorization.
8. Connect an SSH Connection using a key file chosen through the picker. Quit,
   reopen, and connect again without re-selecting the key.
9. Capture a screenshot with the default folder and confirm it is written and
   listed. Point the folder at a real folder via `settings.screenshotsBrowse`,
   capture, quit, reopen, and capture again without another prompt.
10. Open an SFTP or Local Files Connection and confirm the local pane opens in a
    readable folder and that no Places entry errors when clicked.
11. Confirm the Screenshots Module shows no media-type picker and Settings shows
    no video-format control, and that right-clicking Don't Sleep opens no
    schedule menu.
12. Repeat 8-11 on the ordinary macOS build: video recording, the shutdown
    schedule menu, `~/Pictures/Screenshots`, and the real home folder in the SFTP
    local pane must all behave exactly as before.

Bookmarks are stored atomically under the app-data `sandbox-bookmarks/` directory,
outside SQLite and Settings exports. Existing paths remain usable as picker hints,
and there is no schema migration or seed reconciliation. Startup does re-open the
grants for already-configured paths (`Storage::configured_local_paths` feeding
`app_store_files::activate_path`); that is a read-only pass over existing settings
and Connection rows, writes nothing, and is skipped entirely in other builds. See
manual chapters 2, 5, 7, 8, 11, 14, and 15 for the corresponding user-facing
behavior.

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

Bookmarks are stored atomically under the app-data `sandbox-bookmarks/` directory,
outside SQLite and Settings exports. Existing paths remain usable as picker hints;
there is no schema migration, startup scan, or seed reconciliation. See manual
chapters 8, 11, and 15 for the corresponding user-facing behavior.

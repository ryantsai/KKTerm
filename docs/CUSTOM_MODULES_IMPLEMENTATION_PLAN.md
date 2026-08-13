# Custom Modules implementation plan

Status: Implementation complete; desktop release QA remains a release gate

Custom Modules are optional, locally installed extension packages that contribute
permanent top-level Module destinations to KKTerm. Packages are not part of the
KKTerm installer. A user installs them later from the first-party catalog or from
a local `.kkmod` file.

This plan implements ADR 0005. First-party and third-party packages use the same
package format, isolated runtime, permissions, storage, and lifecycle. First-party
status changes catalog presentation and package-signing trust only; it does not
grant private host capabilities.

## Success criteria

- Settings contains a searchable **Custom Modules** section.
- A user can install a static `.kkmod`, inspect its publisher, license, declared
  permissions, and package source, enable or disable it, show or hide its Module
  contribution in the Activity Rail, and uninstall it.
- Installed package payloads remain outside the main installer and outside
  SQLite. SQLite stores validated metadata, grants, lifecycle state, and isolated
  key/value data.
- Enabled Module contributions appear as durable Activity Rail destinations and
  load in a dedicated native WebView without a localhost service.
- External module code cannot call KKTerm's ordinary Tauri commands. It can call
  only a caller-bound, permission-checked Custom Module bridge.
- Local packages work offline after installation. Failed upgrades retain a
  recoverable previous version.
- First-party packages can be added to a signed catalog without changing KKTerm's
  frontend routing or Rust command list.
- Excalidraw can be shipped later as a separate package, with its MIT license and
  third-party notices inside that package rather than the KKTerm installer.

## Package format

A `.kkmod` is a ZIP archive with this shape:

```text
kkterm-extension.json
dist/index.html
dist/assets/...
licenses/LICENSE
licenses/THIRD_PARTY_NOTICES.txt
```

The v1 manifest contains:

- stable reverse-domain package id, display name, version, publisher, summary;
- host API compatibility version;
- license name, license file, optional notices file, and homepage;
- one or more `modules` contributions with a stable id, title, icon, entrypoint,
  and default Activity Rail visibility;
- requested permissions.

First-party download URL, host API version, checksum, signature, download size,
declared license, and requested permissions live in the app-owned catalog rather
than the package manifest.

V1 payloads are static HTML, CSS, JavaScript, JSON, images, fonts, and WASM.
Node.js is allowed as a package build tool but is not a KKTerm runtime. Packages
cannot contain executables, native libraries, shell scripts, symbolic links, or
an application server.

## Delivery gates

### 1. Command isolation

- Register KKTerm custom commands as explicit Tauri ACL permissions for the main
  window.
- Give `custom-module-*` WebViews only the narrow Custom Module bridge commands.
- Derive the package identity from the calling WebView label and backend runtime
  registry; never trust a package id supplied by module JavaScript.
- Add a policy test that fails if an extension WebView can invoke an ordinary
  application command.

No external package may load until this gate passes.

### 2. Persistence and package service

- Add schema-versioned tables for installed packages, retained versions,
  permission grants, and isolated storage.
- Store extracted package versions under the resolved KKTerm data directory.
- Validate manifests and archives before activation: bounded entry count and
  expanded size, safe relative paths, no links, no duplicate/case-colliding
  paths, allowed file types, required license files, compatible API version, and
  matching package hash/signature.
- Extract into a staging directory, flush files, and atomically promote the
  staged version. Keep the previous version available for explicit rollback if
  the newly activated version fails at runtime.
- Implement list, inspect, install-from-file, catalog install/update, enable,
  disable, rail visibility, uninstall, and data deletion commands.
- Stream cancellable download progress and expose actionable errors without
  persisting transient runtime progress.

### 3. Runtime and bridge

- Register app-owned package protocols at startup and load the active package
  entrypoint into a borderless native WebView.
- Use the URL Connection overlay geometry and parent/owner behavior, while
  keeping a separate Custom Module runtime registry and lifecycle.
- Apply a restrictive CSP, correct MIME types, navigation filtering, and denied
  popup-window behavior. Direct external navigation is denied; a granted
  `openExternal` bridge request opens HTTP(S) links in the system browser.
- Implement readiness with a bounded startup timeout, host context,
  theme/locale/visibility notifications, isolated quota-bound storage, and the
  mediated external-link API. User-selected browser file inputs remain inside
  the isolated WebView; v1 exposes no arbitrary host-filesystem API.
- Participate in the shared native-overlay intersection registry so dialogs and
  popovers cannot render underneath the module WebView.

### 4. Settings management

- Add Settings > Custom Modules to navigation, search, assistant context, and
  tutorial navigation.
- Show installed packages and available first-party catalog entries, trust and
  compatibility state, requested permissions, license/notices, and package
  health.
- Add install-from-file, install/update, enable/disable, Activity Rail visibility,
  and uninstall controls.
- Use Status Bar progress/notices and shared dialog primitives. Permission
  expansion and destructive data deletion require explicit confirmation.
- Add English i18n keys and one pending localization file per new key.

### 5. Dynamic Activity Rail

- Replace custom-module compile-time routing with namespaced destinations of the
  form `custom:<package-id>:<contribution-id>`.
- Merge enabled visible contributions into the durable rail order without
  turning package ids into TypeScript unions.
- Render any contribution through one generic Custom Module host and provide
  stable missing, disabled, incompatible, and failed states.

### 6. Reference fixture and documentation

- Ship a tiny development/test `.kkmod` fixture that exercises readiness,
  storage, theme, locale, keyboard input, and external links.
- Keep Excalidraw itself out of KKTerm. Document the separate packaging/release
  process, MIT attribution, and dependency/font notice audit.
- Update architecture, roadmap, Settings manual, localization guidance links,
  and the extension ADR implementation status.

## Verification

- Rust unit/integration tests: manifest validation, malicious ZIP rejection,
  hashes/signatures, permission deltas, storage isolation/quota, caller binding,
  migrations and current-version reopen, atomic activation and rollback.
- Frontend tests: Settings navigation/search/assistant/tutorial mappings,
  installed/catalog states, confirmation flows, dynamic rail normalization and
  routing, host lifecycle, and native-overlay policy.
- Run `npm run check`, `npm run build`, `cargo check --manifest-path
  src-tauri/Cargo.toml`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
- Release QA validates installation, restart persistence, input/focus, module switching,
  dialogs, URL/RDP overlap, disable/uninstall, and offline startup in the real
  Tauri runtime on supported platforms before release.

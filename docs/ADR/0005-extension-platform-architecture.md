# ADR 0005: Extension Platform Architecture

## Status

Accepted

## Context

Milestone G wants KKTerm to support user-installed extensions and to let the
AI Assistant help draft extensions. That cannot become a real creation or
installation flow until KKTerm defines the extension trust model first.

KKTerm is local-first and handles terminal commands, host metadata,
credentials, screenshots, SFTP paths, URL surfaces, and remote desktop surfaces.
Generated or user-installed code must not get broad access to those boundaries
by default.

## Decision

KKTerm extensions will start as signed-or-local user-installed packages with
a manifest, explicit permissions, isolated storage, and user-mediated lifecycle
actions.

The first implemented package kind is a Custom Module `.kkmod`. It contains:

- root `kkterm-extension.json` manifest.
- bundled static HTML/CSS/JavaScript/WASM and media below `dist/`.
- license and optional third-party notice files.
- one or more top-level Module contributions.

The manifest declares:

- stable extension id.
- name, version, publisher, and description.
- requested KKTerm API version.
- Module contributions with stable ids, entrypoints, icons, and rail defaults.
- requested permissions.

Storage namespaces are derived from the stable package id rather than supplied
by the package. First-party download URL, hash, signature, size, declared
license, and requested permissions live in the app-owned catalog, not in the
package manifest.

The implemented v1 permission families are deliberately narrow:

- `storage`: quota-bound access to the package's isolated non-secret namespace.
- `openExternal`: request opening an HTTP(S) URL in the system browser.

The following permission families remain the reviewed expansion direction and
are not exposed to v1 Custom Module code:

- `connections:read`: read non-secret Connection metadata.
- `connections:write`: create or edit durable Connections.
- `workspace:read`: inspect active Tab and Pane metadata.
- `workspace:write`: open Tabs, focus Tabs, or arrange workspace surfaces.
- `terminal:propose-input`: stage terminal input for user approval.
- `sftp:read`: list SFTP paths from an active SFTP Session.
- `sftp:write`: stage upload, download, rename, delete, mkdir, chmod, or chown
  actions for user approval.
- `screenshot:request`: request explicit screenshot capture through the existing
  screenshot consent flow.
- `secrets:reference`: request secret presence by owner id, never raw secret
  values.
- `network:fetch`: perform outbound HTTP requests to declared origins.
- `storage:extension`: superseded for Custom Modules by the v1 `storage` grant.

Extensions cannot directly read terminal contents, raw screenshots, credentials,
AI API keys, SSH private keys, or arbitrary SQLite tables. Extensions cannot run
local commands, terminal input, SFTP write actions, install/update operations,
or other state-changing host actions without a KKTerm approval surface.

Install lifecycle:

- User chooses an extension package.
- KKTerm validates the manifest and package shape.
- KKTerm shows identity, publisher, license, permissions, source, and trust
  warnings.
- User explicitly approves install.
- KKTerm stores package metadata in SQLite and package files under an app
  data extension directory.
- Invalid, unknown-permission, unsafe, or incompatible packages are rejected
  before extraction. Valid reviewed packages are enabled after install.

Update lifecycle:

- Updates are user-mediated.
- Every install or update has an explicit review screen.
- New or broader permissions require explicit approval.
- Auto-install updates are deferred.

Execution model:

- V1 Custom Modules run in a dedicated borderless native WebView over a React
  placeholder. They do not run in the main React realm and do not start a local
  HTTP service or Node.js runtime.
- An app-owned `kkmodule` protocol serves only files from the active validated
  package root with a restrictive CSP and MIME headers.
- Tauri application commands use generated ACL permissions. The trusted main
  window receives the application command surface; `custom-module-*` windows
  receive only `custom_module_bridge`.
- The bridge derives package identity from the calling WebView label and the
  backend runtime registry, then enforces grants and storage isolation.
- First-party and local packages use the same runtime. First-party catalog trust
  adds Ed25519 signature verification but no private capability bypass.

Storage model:

- SQLite stores extension metadata, enabled/disabled state, granted permissions,
  install timestamps, active/previous versions, and non-secret extension settings.
- Each extension gets an isolated storage namespace.
- Secrets stay in the OS keychain and are referenced through existing owner ids
  or future extension-specific secret owners.
- Extension package files live under app data, outside the Connection and
  diagnostics data models.

AI Assistant integration:

- The Assistant may draft an extension manifest, permission request, source
  files, test plan, and review checklist.
- The Assistant must not claim generated code has been installed, enabled,
  loaded, executed, written to disk, or verified unless a future explicit
  approval flow performs that action.
- Any generated extension package must go through the same install review as a
  user-provided package.

## Consequences

The extension platform can grow without breaking KKTerm's local-first trust
model. Installable Custom Modules remain gated by manifest/archive validation,
permission review, isolated storage, explicit lifecycle actions, Tauri command
ACLs, and a caller-bound native WebView bridge.

Broader Connection, Session, terminal, SFTP, screenshot, secret-reference, and
network capabilities remain deferred until each one has its own typed bridge,
backend enforcement, approval semantics, and tests.

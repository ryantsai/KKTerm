# Custom Module packaging

Custom Modules are optional static web applications distributed as `.kkmod`
ZIP archives. They are installed after KKTerm and never add a Node.js runtime,
HTTP service, executable, native library, or package `node_modules` tree to the
KKTerm installer.

## Build contract

Build the external project normally, then package only its production browser
assets, manifest, and license files:

```text
kkterm-extension.json
dist/index.html
dist/assets/...
licenses/LICENSE
licenses/THIRD_PARTY_NOTICES.txt
```

All asset references must be relative so they work below the app-owned
`kkmodule` origin. Runtime scripts, styles, images, fonts, and WASM must be local
package files. V2 CSP blocks direct network connections, remote scripts/frames,
service workers, objects, and form submission while allowing same-package
frames and dedicated workers. A restrictive browser Permissions Policy
also denies device, sensor, media-capture, location, payment, and similar
ambient host capabilities. Clipboard access is available only to packages that
declare and are granted `clipboard`.

Without that permission, `navigator.clipboard` is present only as a
nonfunctional compatibility shim. Every read or write rejects with
`NotAllowedError` and cannot expose the operating-system clipboard.

Declare `browserStorage` to retain package-origin `localStorage`, IndexedDB, and
the Storage API across launches. Without it, `localStorage` is an in-memory
shim and IndexedDB/Storage are disabled. Cookies, Cache Storage, and service
workers stay disabled. Every package has a distinct stable origin/profile.
Declare `storage` for quota-bound durable non-secret JSON. User-mediated native
open/save uses the structured `files` grant and opaque session tokens; paths are
never returned to package code.

Large non-secret JSON documents use the separate `documentStorage` permission
and `window.KKTerm.documents` API. Raw binary data uses `blobStorage` and the
chunked `window.KKTerm.blobs` API. The host stores
immutable SHA-256-addressed JSON files outside SQLite and keeps only key/hash/
size/timestamp metadata in SQLite. The package quota is 512 MiB, each document
is capped at 64 MiB, and a package may keep at most 4,096 document keys.

Installed builds resolve those files through the platform app-data directory.
Windows portable builds resolve the same layout through the executable's
sibling `data` directory: metadata and small storage use `data/kkterm.sqlite3`,
and package files, document files, WebView data, catalog artifacts, downloads,
and staging stay below `data/custom-modules/`. A portable Module must not derive
or persist an absolute host path; use the bridge and keep the complete portable
folder together when moving the app.

Archive paths use portable ASCII letters, digits, `/`, `.`, `_`, `-`, and `@`;
spaces, backslashes, traversal, Windows reserved device names, and trailing dots
are rejected. Payload files belong below `dist/` or `licenses/`, and only the
documented static web/media/font/WASM and license text types are accepted.
The local-file confirmation is bound to the reviewed archive SHA-256, so a file
changed between review and activation is rejected and must be reviewed again.

## Host runtime integration constraint

This is a KKTerm host-maintenance rule rather than a package-format field. Any
Tauri command that constructs a Custom Module `WebviewWindow` must be `async`.
On Windows, `WebviewWindowBuilder` construction from a synchronous command can
deadlock WebView2 and Tauri's IPC dispatcher. Affected Modules appear to start
but never finish `window.KKTerm.ready()`, while unrelated main-window invokes
can remain pending. Keep the command-boundary policy test and verify startup in
the real Windows Tauri runtime whenever this path changes.

The development fixture under `custom-modules/fixtures/hello-world/` exercises
the v2 host context, lifecycle events, isolated storage, readiness handshake,
and external-link bridge. Build its installable archive with:

```bash
npm run package:custom-module-fixture
```

## KKTerm-curated publishing

Curated catalog packages use the same manifest, WebView, permissions, and
storage as local packages. They are not bundled into KKTerm releases. Manual
publication uses `scripts/publish-custom-module.ps1` after the KKMod development
skill has built, audited, and validated the archive. Every rail-visible curated
contribution must declare a packaged SVG icon no larger than 64 KiB. The
publisher rejects active or external SVG content, and KKTerm renders the icon
as a `currentColor` mask so curated Activity Rail icons stay monochrome across
all themes. The desktop host also validates optional SVG artwork from local
packages before displaying it; missing, invalid, active, external, or oversized
artwork falls back to the generic Package rail glyph.

The publication workflow:

1. Build and audit the static package.
2. Compute its SHA-256.
3. Sign the lowercase hexadecimal SHA-256 text with the Ed25519 catalog key.
4. Upload the immutable archive to a content-addressed Cloudflare R2 key and
   verify it through the production HTTPS custom domain.
5. Add id, name, version, publisher, summary, host API version, URL, hash,
   Base64 signature, declared license, requested permissions, and download size
   to a signed online catalog payload. Upload this catalog last.
6. Optionally snapshot the current online entries into the bundled
   `custom-modules/catalog.v2.json` baseline before a KKTerm release.
7. Provide the matching public key as
   `KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY` while building KKTerm. A build
   without that release key deliberately cannot verify catalog packages.
8. Provide the signed catalog URL as `KKTERM_CUSTOM_MODULE_CATALOG_URL` while
   building KKTerm. An unset URL deliberately leaves the build baseline-only.

The signing private key must never enter this repository or a module package.
See `docs/CUSTOM_MODULE_CATALOG.md` for R2 setup, exact commands, catalog
renewal, cache behavior, and recovery.

## Excalidraw reference package

Excalidraw should live in a separate package/release project and remain absent
from the KKTerm installer. Build its self-contained production web output and a
small adapter that calls `window.KKTerm.ready()`, applies host context changes,
stores scene JSON, library items, and individual encoded image assets through
`window.KKTerm.documents`, and maps deliberate import/export to browser or
opaque-token host file APIs. Standard user-activated library links are mediated
through `openExternal` by the host.

Excalidraw is MIT-licensed, so redistribution and modification are permitted if
the copyright and license notice remain with the distributed software. The
package must include the upstream Excalidraw MIT license and an intentional
audit of every bundled dependency, icon, example asset, and font. Put all
required notices in `licenses/THIRD_PARTY_NOTICES.txt`, declare it as
`noticesFile`, preserve upstream marks accurately, and describe the package as
an unofficial KKTerm integration unless upstream authorizes different wording.

Before catalog publication, validate the precise upstream version and its
dependency/license output again; the MIT license of Excalidraw itself does not
automatically cover every bundled third-party asset.

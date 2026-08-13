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
package files. V1 CSP blocks network connections, remote scripts, frames,
workers, objects, and form submission. A restrictive browser Permissions Policy
also denies clipboard, device, sensor, media-capture, location, payment, and
similar ambient host capabilities.

Durable browser `localStorage`, IndexedDB, Cache Storage, cookies, and origin
storage are unavailable to package code; `localStorage` is an in-memory
compatibility shim for the current Module session. Declare `storage` and use
`window.KKTerm.storage` for quota-bound durable non-secret data. A browser file
input can still read a file the user deliberately selects, but v1 has no
arbitrary filesystem bridge.

Archive paths use portable ASCII letters, digits, `/`, `.`, `_`, `-`, and `@`;
spaces, backslashes, traversal, Windows reserved device names, and trailing dots
are rejected. Payload files belong below `dist/` or `licenses/`, and only the
documented static web/media/font/WASM and license text types are accepted.
The local-file confirmation is bound to the reviewed archive SHA-256, so a file
changed between review and activation is rejected and must be reviewed again.

The development fixture under `custom-modules/fixtures/hello-world/` exercises
the v1 host context, theme/locale event, isolated storage, readiness handshake,
and external-link bridge. Build its installable archive with:

```bash
npm run package:custom-module-fixture
```

## KKTerm-curated publishing

Curated catalog packages use the same manifest, WebView, permissions, and
storage as local packages. They are not bundled into KKTerm releases. Manual
publication uses `scripts/publish-custom-module.ps1` after the KKMod development
skill has built, audited, and validated the archive. The publication workflow:

1. Build and audit the static package.
2. Compute its SHA-256.
3. Sign the lowercase hexadecimal SHA-256 text with the Ed25519 catalog key.
4. Upload the immutable archive to a content-addressed Cloudflare R2 key and
   verify it through the production HTTPS custom domain.
5. Add id, name, version, publisher, summary, host API version, URL, hash,
   Base64 signature, declared license, requested permissions, and download size
   to a signed online catalog payload. Upload this catalog last.
6. Optionally snapshot the current online entries into the bundled
   `custom-modules/catalog.v1.json` baseline before a KKTerm release.
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
and maps document persistence/import/export to the supported bridge or browser
file APIs.

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

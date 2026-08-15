# KKMod package contract — host API v2

The installed KKTerm validator is authoritative. `apiVersion: 2` is the only
supported contract; every other value is rejected.

## Archive shape

```text
kkterm-extension.json
dist/index.html
dist/assets/...
licenses/LICENSE
licenses/THIRD_PARTY_NOTICES.txt
```

The `.kkmod` file is a ZIP with at most 10,000 entries, 1 GiB compressed,
1 GiB expanded, and 128 MiB per entry. Entries must be regular files or
directories: no links, executables, native libraries, scripts, duplicate or
case-colliding names, traversal, absolute paths, backslashes, trailing dots,
Windows device names, or unsafe compression ratios.

Paths contain only ASCII letters, digits, `/`, `.`, `_`, `-`, and `@`.
Production browser assets live below `dist/`; license text lives below
`licenses/`. The manifest is root-only UTF-8 JSON and is capped at 1 MiB.

The validator accepts browser code, markup, maps, fonts, images, WASM, and
inert runtime data below `dist/`. Runtime data may use `.gz`, `.bcmap`, `.pfb`,
`.ftl`, `.icc`, `.whl`, or `.zip` when a packaged browser/WASM runtime needs
those exact filenames. Native libraries, executables, shell scripts, and other
unlisted payload types remain forbidden.

## Strict manifest

Unknown fields are rejected at every level.

```json
{
  "id": "com.example.my-module",
  "name": "My Module",
  "version": "2.0.0",
  "publisher": "Example",
  "summary": "A useful local Module.",
  "apiVersion": 2,
  "homepage": "https://example.com/module",
  "license": {
    "name": "MIT",
    "file": "licenses/LICENSE",
    "noticesFile": "licenses/THIRD_PARTY_NOTICES.txt"
  },
  "permissions": {
    "storage": true,
    "documentStorage": true,
    "blobStorage": true,
    "browserStorage": true,
    "openExternal": true,
    "clipboard": true,
    "files": {
      "open": true,
      "save": true,
      "extensions": ["json", "png"]
    },
    "networkFetch": {
      "origins": ["https://api.example.com"],
      "methods": ["GET", "POST"],
      "allowPrivateNetwork": false,
      "maxResponseBytes": 16777216
    },
    "secretReferences": true,
    "hostUi": true,
    "hostAi": true
  },
  "modules": [
    {
      "id": "main",
      "title": "My Module",
      "icon": "dist/icon.svg",
      "entrypoint": "dist/index.html",
      "railVisible": true,
      "routing": "spa"
    }
  ]
}
```

- `id` and contribution ids start with a lowercase letter and contain lowercase
  letters, digits, dots, and hyphens; maximum 128 bytes.
- `version` is SemVer and at most 64 bytes.
- `name`/contribution title are required and at most 128 bytes; publisher is
  required and at most 256; summary is at most 2,048.
- Homepage is optional absolute HTTP(S).
- License name and packaged file are required; notices are optional.
- One to 64 contributions are allowed. Entrypoints are `.html` below `dist/`.
- `routing` is `static` or `spa` and defaults to `static`.
- `railVisible` defaults to true. Curated visible contributions require an
  inert packaged SVG no larger than 64 KiB. The host renders it as a monochrome
  mask using the current theme.

## Permissions

`permissions` is an object and defaults to `{}`. Boolean grants default false:

- `storage`, `documentStorage`, `blobStorage`, `browserStorage`
- `openExternal`, `clipboard`, `secretReferences`, `hostUi`, `hostAi`

`files` is absent or contains `open`, `save`, and up to 128 unique lowercase
extensions without dots. At least one operation must be true.

`networkFetch` is absent or contains 1–64 unique canonical origins, 1–8 unique
methods from `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, a private-network
flag, and a 1-byte to 64-MiB response cap. Origins normally require HTTPS and
have no credentials, path, query, or fragment. HTTP requires an explicit
private-network grant.

Permission parameters are grant data. Any boolean widening, new file operation
or extension, added network origin/method, private-network enablement, or larger
response limit requires fresh update approval.

## Catalog schema

The bundled baseline is `custom-modules/catalog.v2.json`:

```json
{ "schemaVersion": 2, "modules": [] }
```

An online catalog uses a signed envelope and payload, both schema version 2.
Each entry repeats id, identity text, version, `apiVersion`, immutable HTTPS URL,
lowercase SHA-256, Ed25519 signature over that hash text, license, complete
structured permissions, and download size. Catalog metadata must exactly match
the downloaded manifest. Online payloads have a monotonic positive sequence,
generation/expiry timestamps, and a maximum 45-day validity window.

## Build and validation

Node or another toolchain may build `dist/`, but no build runtime ships in the
archive. Use relative packaged assets and external script files. Audit the final
generated HTML after all flattening, copying, and finalizer steps: every local
`href`, `src`, `poster`, or `data` reference must resolve inside the
package's `dist/` tree. A page at `dist/tool.html` must use
`./assets/...`, not `../../assets/...` or `/assets/...`. Validate both the
source directory and final immutable archive:

```powershell
python <skill-dir>\scripts\kkmod_tool.py check <module-root>
python <skill-dir>\scripts\kkmod_tool.py pack <module-root> <name>.kkmod
python <skill-dir>\scripts\kkmod_tool.py check <name>.kkmod
```

The install confirmation is bound to the reviewed archive SHA-256. Any byte
change requires review again.

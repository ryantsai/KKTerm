# KKMod package contract — host API v1

## Contents

- Archive layout
- Manifest schema
- Validation constraints
- Catalog metadata
- Licensing requirements

## Archive layout

A `.kkmod` is a ZIP archive. Package only these roots:

```text
kkterm-extension.json              required, exactly at archive root
dist/                              production browser assets
  index.html                       typical entrypoint; exact path comes from manifest
  ...
licenses/
  LICENSE                          required path is declared in manifest
  THIRD_PARTY_NOTICES.txt          optional path is declared in manifest
```

The package must contain the root manifest, every declared entrypoint and icon, the declared license, and the declared notices file. Required filenames are case-sensitive. Source code, build configuration, `node_modules`, executables, and application servers stay outside the archive.

## Strict manifest schema

The root file is UTF-8 JSON. All objects reject unknown fields. Use camelCase exactly.

```json
{
  "id": "com.example.module",
  "name": "Example Module",
  "version": "1.0.0",
  "publisher": "Example Publisher",
  "summary": "A concise purpose statement.",
  "apiVersion": 1,
  "homepage": "https://example.com/module",
  "license": {
    "name": "MIT",
    "file": "licenses/LICENSE",
    "noticesFile": "licenses/THIRD_PARTY_NOTICES.txt"
  },
  "permissions": ["storage", "documentStorage", "openExternal", "clipboard"],
  "modules": [
    {
      "id": "main",
      "title": "Example Module",
      "icon": "dist/assets/icon.svg",
      "entrypoint": "dist/index.html",
      "railVisible": true
    }
  ]
}
```

### Top-level fields

| Field | Required | Constraint |
|---|---:|---|
| `id` | yes | 1–128 characters; starts with lowercase ASCII letter; then lowercase letters, digits, dots, or hyphens |
| `name` | yes | non-blank, at most 128 bytes |
| `version` | yes | valid SemVer, at most 64 bytes |
| `publisher` | yes | non-blank, at most 256 bytes |
| `summary` | no | defaults to `""`; at most 2,048 bytes |
| `apiVersion` | yes | exactly `1` |
| `homepage` | no | valid absolute `http` or `https` URL |
| `license` | yes | strict object described below |
| `permissions` | no | defaults to `[]`; unique values from `storage`, `documentStorage`, `openExternal`, `clipboard` only |
| `modules` | yes | 1–64 strict contribution objects; ids unique within package |

### `license` fields

| Field | Required | Constraint |
|---|---:|---|
| `name` | yes | non-blank, at most 128 bytes; use the actual SPDX-style license name when possible |
| `file` | yes | portable relative path to a packaged license file; conventionally `licenses/LICENSE` |
| `noticesFile` | no | portable relative path to packaged third-party notices |

### `modules[]` fields

| Field | Required | Constraint |
|---|---:|---|
| `id` | yes | same identifier rules as package id; unique in this manifest |
| `title` | yes | non-blank, at most 128 bytes |
| `icon` | no | packaged portable path below `dist/` |
| `entrypoint` | yes | packaged portable `.html` path below `dist/`; lowercase `.html` extension |
| `railVisible` | no | boolean; defaults to `true` |

One package may contribute multiple Activity Rail Modules. Their durable destination keys are derived by KKTerm as `custom:<package-id>:<contribution-id>`.

## Validation constraints

### Portable paths

- Use only ASCII letters, digits, `/`, `.`, `_`, `-`, and `@`.
- Limit each path to 240 bytes.
- Use relative forward-slash paths only. Reject empty segments, `.`, `..`, backslashes, absolute paths, trailing dots, and traversal.
- Reject Windows device names `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, and `LPT1`–`LPT9`, including names with extensions.
- Reject duplicate paths and case-insensitive collisions.
- Reject symbolic links. Declared files must exist with exact case.

### Allowed payloads

At root, only `kkterm-extension.json` is allowed. Under `dist/`, allowed extensions are:

```text
html css js mjs json map wasm svg png jpg jpeg gif webp avif ico
woff woff2 ttf otf txt md xml webmanifest
```

Under `licenses/`, files may have no extension or use `txt`, `md`, or `html`.

Executable/native/script payloads are explicitly forbidden, including `exe`, `dll`, `so`, `dylib`, `bat`, `cmd`, `com`, `ps1`, `sh`, `app`, `msi`, and `jar`.

### Limits

| Limit | Value |
|---|---:|
| Compressed archive | greater than 0 and at most 256 MiB |
| ZIP entries | 1–10,000 |
| Expanded total | at most 512 MiB |
| Single file | at most 128 MiB |
| Manifest | at most 1 MiB |
| Per-entry expansion ratio | at most 1,000:1 using host integer-ratio check |

Local installation review is bound to the archive SHA-256. If the file changes after review, installation is rejected and the user must review it again.

## Catalog metadata

The app-owned catalog has this strict schema:

```json
{
  "schemaVersion": 1,
  "modules": [
    {
      "id": "com.example.module",
      "name": "Example Module",
      "version": "1.0.0",
      "publisher": "Example Publisher",
      "summary": "A concise purpose statement.",
      "apiVersion": 1,
      "downloadUrl": "https://downloads.example.com/example-1.0.0.kkmod",
      "sha256": "64-lowercase-hex-characters",
      "signature": "base64-ed25519-signature",
      "license": "MIT",
      "permissions": ["storage"],
      "downloadSize": 12345
    }
  ]
}
```

Catalog ids are unique. Identity (`id`, `name`, `version`, `publisher`), API version, permission set, and license name must match the downloaded manifest exactly. `downloadUrl` must use HTTPS. `downloadSize` is 1–256 MiB. `sha256` is lowercase hexadecimal. `signature` is Base64 Ed25519 over the lowercase SHA-256 text, not over the raw archive bytes. Release builds embed the verifying key from `KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY`; private signing keys must never enter the repository or package.

## Licensing requirements

- Include the module's actual redistribution license at the declared `license.file`.
- Audit every bundled dependency, font, icon, image, example asset, and media file for the precise release build.
- Include required notices at `noticesFile`; do not assume the main project's license covers bundled third-party assets.
- Preserve copyright and attribution text.
- Describe unofficial integrations accurately unless upstream authorizes another relationship.
- For Excalidraw, preserve its MIT notice and audit the exact version's full dependency/font/asset output before publication.

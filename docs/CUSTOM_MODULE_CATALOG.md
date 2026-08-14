# Curated Custom Module catalog

KKTerm distributes optional curated `.kkmod` packages independently from the
desktop installer. Cloudflare R2 stores immutable package objects and the latest
signed catalog. KKTerm embeds a baseline catalog for offline and recovery use,
then refreshes and caches newer verified metadata at runtime.

## Trust and object layout

One dedicated Ed25519 release key signs both each package SHA-256 string and the
exact online catalog payload bytes. Do not reuse the Tauri updater key, platform
code-signing certificates, SSH keys, or GPG keys.

```text
R2 bucket
├── catalog/v2/catalog.json
└── packages/sha256/<64-lowercase-hex>.kkmod
```

`catalog.json` is an envelope containing `schemaVersion`, the SHA-256-derived
`keyId`, a Base64 UTF-8 payload, and a Base64 Ed25519 signature. The payload has
its own schema version, a monotonically increasing sequence, `generatedAt`,
`expiresAt`, and the latest curated entry for each Module id. The default
validity period is 30 days and the client rejects periods longer than 45 days.

Package objects are immutable and uploaded before catalog metadata. Publishing
the catalog last ensures an interrupted run cannot advertise a missing package.
Publishing the same id and version with different bytes or publishing a lower
version is rejected.

## Cloudflare R2 setup

1. Create a Standard-class bucket, for example:

   ```powershell
   npx wrangler r2 bucket create kkterm-custom-modules --location=apac
   ```

2. In the R2 dashboard, connect a production custom domain such as
   `modules.example.com`. Do not use the rate-limited `r2.dev` development URL
   for released KKTerm builds.
3. Keep `r2.dev` public access disabled after the custom domain is active, so
   Cloudflare security and cache rules cannot be bypassed.
4. Configure a Cache Rule for `packages/sha256/*` to make `.kkmod` responses
   cache eligible and honor their one-year immutable cache metadata. Bypass or
   revalidate cache for `catalog/v2/catalog.json`; JSON is published with
   `no-cache, max-age=0, must-revalidate`.
5. Authenticate Wrangler with a release operator account or a narrowly scoped
   R2 token. The publisher needs object read/write access to this bucket but no
   bucket-administration permission.

Cloudflare documents that R2 custom domains enable Cloudflare Cache, whereas
`r2.dev` is intended only for non-production traffic:
<https://developers.cloudflare.com/r2/buckets/public-buckets/>.

## Key and KKTerm build configuration

Generate an encrypted PKCS#8 Ed25519 key outside the repository:

```powershell
openssl genpkey -algorithm ED25519 -aes-256-cbc -out C:\secure\kkmod-prod.private.pem
```

The dry run prints the raw 32-byte public key as 64 lowercase hexadecimal
characters. KKTerm pins the production public key and catalog URL in
`src-tauri/build.rs`, so ordinary debug and release builds verify the production
catalog without a private `.env`. Copy the committed sample only when overriding
both values together for staging or a signing-key rotation:

```powershell
Copy-Item .env.example .env
```

```dotenv
KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY=<public-key-hex>
KKTERM_CUSTOM_MODULE_CATALOG_URL=https://modules.example.com/catalog/v2/catalog.json
```

`src-tauri/build.rs` loads the repository-root `.env`; an already-set process
environment variable takes precedence. An explicitly empty catalog URL keeps a
build baseline-only while retaining signature verification with the pinned
public key. The real `.env` is ignored by Git.

The private key and its passphrase must never be committed, copied into a
`.kkmod`, or placed in the desktop build environment. Back it up encrypted in
two separately controlled locations.

## Publish or update a Module

Build and validate the Module using the `develop-kkmod-modules` skill. From this
repository, run:

```powershell
npm run publish:custom-module -- `
  -Package C:\releases\example-1.2.0.kkmod `
  -Bucket kkterm-custom-modules `
  -BaseUrl https://modules.example.com `
  -SigningKeyPath C:\secure\kkmod-prod.private.pem
```

The wrapper runs the skill's `kkmod_tool.py check` before asking for the signing
key passphrase. The publisher also requires every rail-visible contribution to
ship a bounded, inert SVG icon; the desktop host renders those curated icons as
monochrome masks. It then downloads and verifies the current catalog, increments
the sequence, signs the package and catalog, uploads the content-addressed
package with `wrangler r2 object put --remote`, verifies its public URL, uploads
the catalog, and verifies the published envelope again.

Use `-DryRun` to validate and print release metadata without writing R2. Use
`-KkmodToolPath` if the skill is installed somewhere other than the default
personal Codex skills directory.

Before a KKTerm desktop release, optionally snapshot the successfully published
entries into the embedded baseline:

```powershell
npm run publish:custom-module -- `
  -Package C:\releases\example-1.2.0.kkmod `
  -Bucket kkterm-custom-modules `
  -BaseUrl https://modules.example.com `
  -SigningKeyPath C:\secure\kkmod-prod.private.pem `
  -WriteBaseline custom-modules/catalog.v2.json
```

This still does not include any `.kkmod` payload in the KKTerm installer; only
small verified metadata enters the executable.

## Catalog renewal

The online catalog expires even when no Module changes. Renew it before expiry:

```powershell
npm run publish:custom-module -- `
  -RenewOnly `
  -Bucket kkterm-custom-modules `
  -BaseUrl https://modules.example.com `
  -SigningKeyPath C:\secure\kkmod-prod.private.pem
```

Renewal preserves entries, increments the sequence, and creates a new bounded
validity window. Set an operational reminder well before the 30-day default.

## Client refresh and recovery

- Settings loads the bundled baseline plus the last unexpired verified cache,
  then attempts an online refresh when the Custom Modules section opens.
- The user can explicitly refresh through `settings.customModulesRefreshCatalog`.
- The client checks HTTPS, envelope key id/signature, exact payload bytes,
  sequence, generation and expiry times, package signatures, metadata schema,
  download origin, sizes, permissions, and semantic versions before caching.
- A lower sequence, altered same-sequence payload, expired catalog, invalid
  signature, or changed established publisher/name is rejected.
- The baseline and online catalogs merge by id, retaining the higher semantic
  version. An online catalog cannot downgrade the bundled baseline.
- Installed Modules continue working offline. Catalog failure affects discovery
  and updates, not already installed local package execution.
- Each successful update retains one prior package version for explicit
  rollback. Module storage is not version-rolled-back, so Module authors must
  keep durable data backward compatible.

In a signing-key compromise, stop publication, remove or block the public
catalog endpoint, issue a KKTerm release with a new trusted public key and safe
baseline, and only then resume publication. This curated phase intentionally has
one build-pinned key; multi-key threshold rotation belongs to the later
third-party marketplace architecture.

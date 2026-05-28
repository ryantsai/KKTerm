# ADR 0007: Installer Helper Remote Catalog and Trust Model

## Status

**Superseded by [ADR 0008](0008-installer-helper-bundled-catalog.md)** —
the Installer Helper now ships its catalog as a compile-time-embedded
JSON inside the KKTerm binary instead of fetching a signed JSON from
GitHub at runtime. This document is retained as the record of the
original design decision and the trade-offs that motivated the change.

## Context

KKTerm needs a built-in **Installer Helper** Module that lets users install,
update, and uninstall a curated catalog of Windows developer tools (Git, Node,
Python, Docker, VS Code, Claude Code CLI, Codex CLI, Gemini CLI, Aider, Ollama,
LM Studio, n8n, etc.). The user-facing goals are:

1. One place to install the dev/AI toolchain on a new Windows machine.
2. Always install the *latest available* version of each tool.
3. New tools can be added to the catalog without releasing a new KKTerm build,
   so the AI-tooling ecosystem can move faster than KKTerm's release cadence.
4. Per-tool install options are presented as a customized interface.

The decision is *how* the catalog itself ships, and the trust boundary that
implies. KKTerm is otherwise local-first (ADR 0003): durable data lives in
SQLite, secrets live in the OS keychain, and there is no remote configuration
fetch. The Installer Helper breaks that property deliberately, and this ADR
records the resulting constraints.

## Decision

The catalog is a **remote, signed JSON document** at a fixed URL, and **recipes
are pure structured data referring to vetted providers**. No part of the
catalog is interpreted as code on the user's machine.

### 1. Hosting

Catalog URL:

```
https://raw.githubusercontent.com/ryantsai/KKTerm/main/installer/catalog.v1.json
https://raw.githubusercontent.com/ryantsai/KKTerm/main/installer/catalog.v1.json.sig
```

Hosted from the existing KKTerm repository (`ryantsai/KKTerm`) on the `main`
branch via `raw.githubusercontent.com`. Pushing a commit that updates these two
files updates every user's catalog on the next fetch — there is no release-cut
required to ship a new tool.

`raw.githubusercontent.com` is treated as untrusted transport. Integrity is
established by the signature, not by TLS or by GitHub's identity.

### 2. Signing

The catalog is signed with **Ed25519**. The corresponding **public key is
compiled into the KKTerm binary** as a Rust constant (`INSTALLER_CATALOG_PUBKEY`
in `src-tauri/src/installer/trust.rs`). Rotating the key requires a KKTerm
release; this is intentional — embedded keys are the only way to bind catalog
trust to the shipped binary rather than to GitHub or to TLS.

Verification flow on every fetch:

1. Download `catalog.v1.json` and `catalog.v1.json.sig` over HTTPS.
2. Verify the signature against `INSTALLER_CATALOG_PUBKEY` **before parsing the
   JSON body**. A failed signature aborts the fetch.
3. Parse the verified body. Reject if `schemaVersion >
   APP_SUPPORTED_CATALOG_SCHEMA`. Reject if any recipe has a `provider.kind`
   the app does not recognize. Reject if the dependency graph has a cycle.
4. On any verification or parse failure, fall back to the cached catalog (§4)
   and emit a Status Bar warning. Do not silently accept a partial parse.

The signature is over the exact JSON bytes; no canonicalization. The signing
side must commit the same byte sequence it signed. CI on the catalog repo is
out of scope here; the signing tool is documented in the Operational notes.

### 3. Recipe shape — structured data only

Recipes are a closed enum of **five provider kinds**, all pure data. Strings in
the JSON identify packages, repositories, or features — never commands.

```rust
enum Provider {
    Winget { id: String },
    Npm { pkg: String, needs: Vec<String> },
    GithubRelease {
        repo: String,                 // "owner/repo"
        asset_pattern: String,        // glob, e.g. "nssm-*-win.zip"
        layout: GithubReleaseLayout,  // Zip | ExeInstaller | Msi
    },
    WindowsFeature { feature: String }, // DISM feature name
    Bundle { steps: Vec<String> },      // ordered list of recipe ids
}
```

There is **no** `Custom`, `PowerShell`, `Shell`, `UrlExec`, or other escape
hatch. A tool that does not fit one of these five shapes does not ship in the
catalog. The Hermes Agent example from the original brainstorm (pip-from-git
clone with system-Python and CUDA dependencies) does not fit and is replaced
with Ollama (winget `Ollama.Ollama`) in the v1 catalog.

The four non-bundle providers are vetted upstream surfaces:

- `winget` invokes `winget install <id>`. The set of valid `id` values is
  whatever the official Microsoft community manifests serve.
- `npm` invokes `npm install -g <pkg>`. `needs` declares prerequisite recipe
  ids (typically `["node-bundle"]`).
- `github-release` calls the GitHub releases API for `repo`, picks the asset
  matching `asset_pattern`, and either extracts the zip (`Zip`), runs the
  installer (`ExeInstaller`, `Msi`), with the underlying installer's standard
  silent flags.
- `windows-feature` enables a Windows optional feature via DISM. Reboot-gated
  (§5).

Bundles compose other recipes by id. A bundle's detection is the AND of its
steps' detections. Bundles execute steps in declared order; an already-
installed step is skipped. The two v1 bundles are `node-bundle` (nvm-windows +
Node.js LTS) and `python-bundle` (uv + Python 3.12). Bundles enable the user-
friendly default while letting power users install components individually.

### 4. Caching and offline fallback

Verified catalogs are cached at:

```
%APPDATA%\KKTerm\installer\catalog.cached.json
%APPDATA%\KKTerm\installer\catalog.cached.json.sig
%APPDATA%\KKTerm\installer\catalog.lastFetchAt
```

The cache is used:

- When the app is offline.
- When a fresh fetch fails signature or schema verification.
- When the last fetch is younger than 1 hour (TTL on Module entry).

A signature failure on a *fresh* fetch keeps the cached version in service and
surfaces a single Status Bar notice. The user can force a re-fetch via the
Module's manual refresh button.

The cache itself is treated as trusted *because it was signature-verified on
the way in*. We do not re-verify on read — that would require keeping the `.sig`
file around indefinitely, which we do anyway, so the verification is a cheap
extra defense and is performed on load.

### 5. Execution constraints

- **No code from the network is ever evaluated.** Recipes are data; the
  installer dispatches on `provider.kind` to native code paths in the Rust
  backend.
- **Dependency resolution is data-only.** `needs` and `bundle.steps` reference
  other recipe ids by string. Cycle detection runs at catalog load.
- **UAC is honest.** Some recipes (machine-scope winget, Docker, WSL feature)
  require elevation; the app never tries to suppress or batch UAC. The
  "Update all" flow shows an up-front warning naming the number of likely
  prompts.
- **Reboot-gated installs are explicit.** Enabling WSL requires a reboot.
  Docker's recipe declares `needs: ["wsl"]`; the Docker install button is
  disabled with an explicit "WSL enabled — reboot required before installing
  Docker" state when the WSL feature was just enabled in the same session.
- **In-flight installs are not transactional.** Cancellation cancels the
  install queue (the next-up tools), not the in-flight provider invocation.
  Partial installs are owned by the underlying installer.

## Consequences

**Positive**

- Adding a tool to the catalog is a PR to `ryantsai/KKTerm`'s
  `installer/catalog.v1.json` + a new `.sig`. No KKTerm release required.
- The signing key is a Windows-native binary constant, not a TLS or GitHub
  identity. CDN, DNS, or repo-access compromise alone cannot push a new
  recipe to KKTerm users — they must also obtain the signing key.
- The closed five-provider enum makes the catalog auditable. Reviewers can
  read the JSON and see exactly which winget id / npm package / GitHub repo a
  tool resolves to. There is no place for a script to hide.
- "Power users can do separate installs themselves without using our help" is
  honored: bundles are a UX convenience, not a forced grouping. Detection
  short-circuits any prerequisite that is already present, so users who
  installed Node manually keep working.
- The signature-verify-then-parse order ensures malformed JSON from a
  compromised origin cannot reach the JSON parser (and thus cannot exploit
  parser vulnerabilities) without first defeating Ed25519.

**Negative**

- KKTerm holds a private signing key. Losing it requires a release that ships
  a new public key; until then the previously-signed cache is the only valid
  catalog.
- The catalog is a single point of remote influence. A compromised key gives
  the attacker the ability to point all users at a malicious *vetted-provider*
  package — e.g. an npm typosquat or a renamed GitHub repo. The five-provider
  enum bounds the blast radius but does not eliminate it. Defense is
  catalog-review discipline: every PR to `installer/catalog.v1.json` should
  cite the upstream package's provenance.
- The `windows-feature` provider can require reboot, and the user experience
  of "click Install on Docker, get told you must reboot first, lose the page
  state" is not great. Mitigated by surfacing the reboot requirement on the
  WSL row before the user starts the Docker install.
- A KKTerm release with a stale `APP_SUPPORTED_CATALOG_SCHEMA` cannot consume
  newer catalogs and falls back to the cached one. Schema bumps need a
  deprecation window where the catalog still emits the older schema.
- `raw.githubusercontent.com` has no SLA. If GitHub blocks it, users fall back
  to cache indefinitely until a new fetch URL is shipped via release. This is
  acceptable because the cache contains the last good catalog.

**Neutral**

- The catalog repo is the same as the app code repo. A separate
  `kkterm-installer-catalog` repo would slightly reduce blast radius (a
  compromised catalog PR would not also touch app source), but adds a
  maintenance surface. This can be revisited later without changing the trust
  model — only the URL constant moves.
- Catalog strings ship in English (`name`, `descriptionEn`) with optional
  per-locale overrides (`descriptionLocales`). Module chrome strings (page
  title, button labels, error messages, UAC warning) use the standard i18n
  pipeline in a new `installer` namespace. Brand names are not translated.
  The split keeps catalog churn from generating localization-todo files for
  14 locales every time a new tool is added.

## Operational notes

### Signing a new catalog version

The signing tool is `minisign` (used because its trust model is exactly the
embedded-pubkey-plus-Ed25519 we are implementing). To generate the keypair
once:

```
minisign -G -p installer-pubkey.minisign -s installer-seckey.minisign
```

`installer-pubkey.minisign` produces the byte sequence to paste into
`INSTALLER_CATALOG_PUBKEY` in `src-tauri/src/installer/trust.rs`.
`installer-seckey.minisign` is held by the catalog maintainer offline. It is
**not** committed to the repo and **not** stored in GitHub Actions secrets in
v1 — manual signing keeps the trust boundary narrow.

To sign a catalog update:

```
minisign -S -s installer-seckey.minisign -m installer/catalog.v1.json
```

This produces `installer/catalog.v1.json.minisig`. The verifier in
`src-tauri/src/installer/trust.rs` accepts the minisign format directly.
Commit both files in the same commit.

### Adding a tool

1. Add an entry to `installer/catalog.v1.json` with a fresh `id`, `name`,
   `descriptionEn`, `provider`, and any `needs` edges.
2. Re-run the signing step. Commit JSON + sig together.
3. Sanity-check: the v1 schema accepts only the five provider kinds; an
   unrecognized kind silently rejects the entire catalog on the user side and
   the cached version stays in use.
4. There is no app release for catalog-only changes.

### Bumping the schema version

1. Define the new schema in code (`installer::schema` module).
2. Update `APP_SUPPORTED_CATALOG_SCHEMA`.
3. Ship a KKTerm release that supports both old and new schema for at least
   one release before publishing a new-schema catalog. Otherwise users on
   older KKTerm builds will fall back to cache and stop receiving updates.

### Rotating the signing key

1. Generate a new keypair.
2. Ship a KKTerm release with the new `INSTALLER_CATALOG_PUBKEY` constant.
   The release should accept *both* keys for one cycle, so users on the old
   build still verify successfully against the old signature.
3. Sign and publish the next catalog with the new key. Old-build users will
   continue using the cached catalog signed with the old key.
4. Next release drops the old key.

### Recipe development

- `winget` ids come from `winget show <id>` against a known machine. Validate
  on a clean Windows VM before merging.
- `npm` recipes must declare `needs: ["node-bundle"]` even though npm-via-Node
  works from PATH — without the declared edge, the user has no UX
  affordance to install Node first.
- `github-release` `asset_pattern` is a glob, not a regex. Test against the
  release page's asset list. Use the most specific pattern possible to avoid
  drift when a repo adds new artifacts (e.g. `nssm-*-win.zip`, not `*.zip`).
- `windows-feature` recipes that require reboot must declare it via a
  `reboot: true` field. The frontend disables dependent recipes until the
  reboot is acknowledged.
- `bundle` recipes do not declare options. Options live on the leaf recipes.

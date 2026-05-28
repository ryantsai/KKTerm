# ADR 0008: Installer Helper — Bundled Catalog (supersedes ADR 0007)

## Status

Accepted. Supersedes [ADR 0007](0007-installer-helper-remote-catalog.md).

## Context

ADR 0007 chose to ship the Installer Helper catalog as a remote signed
JSON fetched from `raw.githubusercontent.com` and verified against an
Ed25519 public key compiled into the binary. The rationale was that new
tools could be added to the catalog without releasing a new KKTerm
build.

After implementing that design end-to-end we revisited the trade-off
and found:

1. **The signing operation is a release-pace operational burden.** Every
   catalog change requires the maintainer to run `minisign` against an
   offline-held secret key. That seemed cheap in the abstract; in
   practice it's friction every time a winget id needs a fix.
2. **The catalog churns about as often as the app does.** The v1 list of
   25 tools (and any plausible extensions) doesn't move weekly. There
   is little practical value in being able to push catalog updates
   independent of KKTerm releases.
3. **Trust complexity dominated the codebase.** The remote-catalog
   pipeline carried a network fetch, signature verification, an on-disk
   cache, a TTL, a cache-fallback warning surface in the UI, and a
   trust ADR (0007) — for what is at heart a static asset.
4. **Windows code-signing of the KKTerm installer is the right
   long-term trust anchor.** When that lands, every byte that ships
   with KKTerm — including the catalog — gets the same integrity
   guarantee from the same signing operation that already happens at
   release time. The Installer Helper does not need its own parallel
   trust boundary.

## Decision

The catalog is **embedded in the KKTerm binary at compile time** via
`include_str!`. There is no network fetch, no on-disk cache, no signature
verification, and no key material to manage.

```rust
// src-tauri/src/installer/catalog.rs
pub const CATALOG_JSON: &str =
    include_str!("../../../installer/catalog.v1.json");

pub fn load_bundled_catalog() -> Result<Catalog, CatalogError> {
    let catalog: Catalog = serde_json::from_str(CATALOG_JSON)?;
    catalog.validate()?;
    Ok(catalog)
}
```

The catalog file `installer/catalog.v1.json` still lives at the repo
root with the same schema as before (five-provider closed enum:
`winget`, `npm`, `githubRelease`, `windowsFeature`, `bundle`). Adding,
editing, or removing a tool is a normal commit; the change rides with
the next KKTerm release.

The `installer_load_catalog` Tauri command remains, but its `force
refresh` parameter is now a no-op kept only for frontend-API
compatibility. The command returns the bundled `Catalog` directly with
no source-kind discriminator.

## What was removed

- `src-tauri/src/installer/trust.rs` (Ed25519 / minisign verification).
- The fetch + cache + TTL logic in `src-tauri/src/installer/catalog.rs`.
- `INSTALLER_CATALOG_PUBKEY` constant.
- The `minisign-verify` Cargo dependency.
- `scripts/installer/sign-catalog.ps1` maintainer helper.
- The `CatalogSourceKind` / `CatalogLoadResponse` TypeScript types.
- The `installer.warningCacheFallback` i18n key and its localization-
  todo backlog file.
- The frontend warning banner that surfaced cache-fallback state.
- The on-disk cache directory `%APPDATA%\KKTerm\installer\` (no longer
  created; existing copies become inert and can be removed in a future
  housekeeping pass).

Total net reduction: ~300 lines plus one dependency.

## What was kept

- The full `Catalog` / `Recipe` / `Provider` schema and its validator.
  These are independent of the loading mechanism and remain useful as-
  is. The `shipped_catalog_parses_and_validates` test still embeds the
  same JSON via `include_str!` and exercises `Catalog::validate()`.
- All per-provider install / uninstall / detect / latest-version
  executors. They do not care where the catalog came from.
- The on-disk install dir `%LOCALAPPDATA%\KKTerm\installer\bin\<id>\`
  for github-release recipes. That's installed-tool state, not catalog
  cache.
- The `installer_tool_state` SQLite table (pinned, latest-version
  cache). Same as before.

## Consequences

**Positive**

- One artifact ships per release: the KKTerm installer. The catalog
  rides inside it.
- No secret-key management. The maintainer has nothing to keep offline.
- The "no catalog available" / "signature failed" failure modes are
  gone. The catalog is always available once the app installed.
- A catalog with malformed JSON fails the existing
  `shipped_catalog_parses_and_validates` Rust test, so `cargo test`
  guards every catalog edit before it can ship.
- Future Windows code-signing of the KKTerm installer protects the
  catalog as a side effect of protecting the app — same trust anchor
  for both.

**Negative**

- Adding a tool now requires a KKTerm release. For a v1 catalog that
  churns slowly this is acceptable; if the catalog ever needs an
  out-of-band hotfix (e.g. a winget id that broke after a vendor
  rename), users have to wait for the next release.
- The original "ship new tools without a release" property is lost.
  Recovering it would mean re-introducing a remote loader — either as
  an optional override (read remote JSON on top of the bundled one,
  with signing) or by reverting to ADR 0007.
- Catalog edits change the binary contents, so they pull in the full
  release cycle (build, sign installer, publish, push update notice).

**Neutral**

- Tauri's `bundle.resources` mechanism could ship the JSON as a
  side-by-side file rather than `include_str!`, allowing the catalog
  to be replaced via an installer patch without rebuilding Rust. We do
  not need that flexibility in v1 — `include_str!` is simpler. If a
  future need arises, switching is a one-file change inside
  `catalog.rs`.

## Migration notes

- Existing users with a cached `%APPDATA%\KKTerm\installer\catalog.
  cached.json` will see those files become inert. No code reads them
  anymore. A housekeeping migration could delete them on first launch
  after upgrade; we currently rely on the OS / user to clean stale
  cache files.
- The frontend `installer_load_catalog` invocation pattern is
  unchanged from the consumer's perspective — the command still
  returns a `Catalog`. The `source` / `sourceDetail` fields are gone
  from the response shape; any frontend code that was reading them is
  also gone.
- ADR 0007's "rotate the signing key" and "sign the catalog" procedures
  no longer apply.

## When this might be revisited

If any of the following becomes true, returning to a remote loader
(ADR 0007's design or a hybrid) is worth reconsidering:

- The catalog grows beyond ~100 entries and edits become weekly.
- A wave of upstream package-id renames creates a need for rapid
  out-of-band hotfixes.
- KKTerm gains the ability to publish patch-only updates that ship
  just the catalog file, making the "ship with release" cost
  negligible anyway.

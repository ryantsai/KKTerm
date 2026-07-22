# ADR 0010: Selective, Category-Aware Export / Import

## Status

Accepted.

## Context

KKTerm shipped two coarse data-movement paths:

1. A **whole-database export** (`export_settings_database`) that packs the
   entire `kkterm.sqlite3` into a ZIP, and an **import**
   (`import_settings_database`) that *replaces* the live file wholesale.
2. No way to move a single Dashboard Custom Widget between machines — the
   only escape was copying the raw script out of a widget's advanced options,
   which could not be re-imported as a widget.

Issue [#378](https://github.com/ryantsai/KKTerm/issues/378) asked for finer
control, framed by two concrete user stories:

- *"Share my SSH/URL Connections with a colleague, but without my passwords."*
- *"Export AI-created widgets individually and import them elsewhere."*

The whole-database path cannot express either: it is all-or-nothing and
destructive, and its ZIP carries the encrypted secret store verbatim when the
encrypted SQLite backend is in use.

## Decision

### Two independent surfaces

- **Widget export/import** (`.kkwidget`, JSON): a small portable format
  `{ product, format:"kkterm-widgets", version, widgets:[…] }`. A single export
  and an "export all" share one `widgets` array so one importer handles both.
  A widget *definition* never contains secrets, so these files are safe by
  construction. Import is **additive only** — each widget becomes a new
  imported Custom Widget with a fresh id; titles are suffixed on collision.

- **Selective database export/import** (`.kkbackup`, ZIP of `manifest.json` +
  `data.json` + optional `secrets.enc`): the user picks which **segments** to
  carry (`connections`, `workspaces`, `dashboards`, `settings`, `mcpServers`;
  bundle v2 added `itops` and `assistant`) and, on import, chooses **per
  segment** whether to Skip, Add (merge), or Replace. The manifest records the
  lowest bundle version able to carry the chosen segments, so bundles without
  the newer segments stay importable by older app versions. The `dashboards`
  segment also carries live Notes widget content from `durable_ui_state`; only
  the Notes namespace is included, and its embedded Widget Instance id is
  remapped during additive import.

### Generic, metadata-driven row copy

Rather than serialize ~10 typed structs (the `connections` table alone has
~35 columns), segments are copied generically: `SELECT *` into JSON row maps on
export, dynamic `INSERT` on import. A small per-table metadata table declares the
primary-key strategy and foreign keys so the engine can remap on merge. This
keeps the code small and resilient to schema additions.

### Merge semantics

- **Add** regenerates every standalone `id` to a fresh value and rewrites
  foreign keys through an accumulated old→new map, so a shared file never
  collides with the importer's rows and repeated imports stay distinct.
- **Replace** clears the segment's tables (child→parent) then inserts.
- Cross-segment foreign keys are resolved against the map first, then against an
  existing local row, otherwise nulled (every cross-segment FK column in the
  schema is nullable). Inserts run parent→child under `foreign_keys = ON`.
- A safety database backup is taken before any import mutation.

### Secrets are opt-in and passphrase-encrypted

Credentials are **excluded by default** — the colleague-sharing case. When
included, Connection / URL / SOCKS proxy passwords are read from the active
credential backend, bundled into `secrets.enc`, and encrypted with an
Argon2id-derived AES-256-GCM key — the same envelope the encrypted SQLite secret
store already uses (`secrets/sqlite_store.rs`). The importer must supply the
passphrase; owner ids are rewritten through the import remap so secrets land on
the merged rows.

## Consequences

- The colleague-sharing and personal-backup stories are both served without the
  destructive whole-database replace.
- **Scope limits (intentional):** only connection-related secrets are carried —
  widget secrets, AI/email/MCP keys, and IT Ops Task vault entries are not, so
  imported features that depend on them prompt for re-entry. IT Ops Task vault
  references are cleared during import so they cannot bind to unrelated local
  secrets. `is_default` is cleared on merged Workspaces to avoid two defaults.
- Whole-database snapshot commands remain for backup/recovery paths. The visible
  Settings Export button uses the selective path; the visible Settings Import
  button accepts both selective `.kkbackup` files and full ZIP snapshots.
- A generic row engine trades the repo's usual typed-struct style for compactness
  in this one subsystem; the per-table metadata is the single place to update if
  the schema of an exported table changes.

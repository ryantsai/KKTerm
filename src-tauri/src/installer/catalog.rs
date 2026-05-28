// Catalog loading. The catalog ships with the KKTerm release: the JSON at
// `installer/catalog.v1.json` is embedded into the binary by `include_str!`
// at compile time. There is no network fetch, no on-disk cache, and no
// signature verification — the trust anchor is the app binary itself
// (eventually backed by Windows code-signing on the installer).
//
// See ADR 0008 for why this supersedes the earlier remote-signed design
// (ADR 0007).

use super::schema::Catalog;

/// The catalog JSON, embedded at compile time. The `shipped_catalog_
/// parses_and_validates` test in `schema.rs` already exercises this
/// constant so a malformed edit fails `cargo test` before it can ship.
pub const CATALOG_JSON: &str = include_str!("../../../installer/catalog.v1.json");

#[derive(Debug)]
pub enum CatalogError {
    Parse(String),
    SchemaInvalid(String),
}

impl std::fmt::Display for CatalogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Parse(msg) => write!(f, "bundled catalog parse failed: {msg}"),
            Self::SchemaInvalid(msg) => {
                write!(f, "bundled catalog schema invalid: {msg}")
            }
        }
    }
}

impl std::error::Error for CatalogError {}

/// Parse and validate the bundled catalog. Cheap (the JSON is in static
/// memory) but not free — callers should cache the result rather than
/// re-parse on every command invocation. `InstallerRuntime::catalog` is
/// where that cache lives.
pub fn load_bundled_catalog() -> Result<Catalog, CatalogError> {
    let catalog: Catalog = serde_json::from_str(CATALOG_JSON)
        .map_err(|e| CatalogError::Parse(e.to_string()))?;
    catalog
        .validate()
        .map_err(|e| CatalogError::SchemaInvalid(e.to_string()))?;
    Ok(catalog)
}

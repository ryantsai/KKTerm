// Shared MCP protocol-version contract for the built-in stdio server.
//
// `kkterm-cli` is a separate binary, so it includes this source file by path
// while the in-app bridge imports it through the library crate. Keep the
// remote MCP client in `mcp.rs` separate: it has its own client-side
// compatibility lifecycle.

pub const LATEST_PROTOCOL_VERSION: &str = "2025-11-25";

pub const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &[
    LATEST_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
    "2024-10-07",
];

pub fn negotiate_protocol_version(requested: &str) -> &'static str {
    SUPPORTED_PROTOCOL_VERSIONS
        .iter()
        .copied()
        .find(|version| *version == requested)
        .unwrap_or(LATEST_PROTOCOL_VERSION)
}

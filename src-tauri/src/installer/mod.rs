// Installer Helper Module — Windows dev-tool installer.
//
// The catalog is compiled into the binary from `installer/catalog.v1.json`
// at build time; it ships with each KKTerm release. See ADR 0008 for the
// supersession of the earlier remote-signed-catalog design (ADR 0007).

pub mod catalog;
pub mod commands;
pub mod detect;
pub mod events;
pub mod install;
pub mod latest_version;
pub mod options;
pub mod schema;
pub mod state;
pub mod uninstall;

pub use commands::InstallerRuntime;

// IT Ops Module backend (docs/ITOPS.md). A built-in site-operations Module:
// durable Sites, Batch Runs, and Automations. Sites are stored in the
// `itops_sites` table (CRUD commands + run-time resolver); the Site topology
// layer (Racks / Rack Devices, docs/SITE.md Phase B) lives in `site_storage`.
// The cross-Site addressing and logical-link layers (IPAM, Network Map) live in
// `ipam_storage` and `network_map_storage`; both are global like `task_storage`.

pub mod actions;
pub mod automation_commands;
pub mod automation_storage;
pub mod commands;
pub mod host_storage;
pub(crate) mod ids;
pub mod inventory;
pub mod ipam_commands;
pub mod ipam_storage;
pub mod ipv4;
pub mod network_map_commands;
pub mod network_map_storage;
pub mod run_storage;
pub mod runner;
pub mod site_storage;
pub mod storage;
pub mod task_commands;
pub mod task_storage;
pub mod types;

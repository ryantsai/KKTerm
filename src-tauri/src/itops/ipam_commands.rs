// Tauri commands for the global IT Ops IPAM destination.

use tauri::{AppHandle, Manager};

use super::ids::new_itops_id;
use super::ipam_storage;
use super::types::{AddressStatus, IpAddressRecord, IpPrefix, IpamSnapshot, PrefixStatus};

/// The whole IPAM view in one call: prefixes with their derived hierarchy and
/// utilization, plus every Address Record. Small enough to reload wholesale
/// after any mutation, which keeps the derived numbers honest.
#[tauri::command]
pub fn itops_ipam_snapshot(app: AppHandle) -> Result<IpamSnapshot, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            ipam_storage::snapshot(conn).map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_create_ip_prefix(
    app: AppHandle,
    cidr: String,
    vrf: String,
    role: String,
    status: PrefixStatus,
    description: String,
    site_id: Option<String>,
) -> Result<IpPrefix, String> {
    let id = new_itops_id("prefix");
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            ipam_storage::create_prefix(
                conn,
                &id,
                &cidr,
                &vrf,
                &role,
                status,
                &description,
                site_id.as_deref(),
            )
            .map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_update_ip_prefix(
    app: AppHandle,
    id: String,
    cidr: String,
    vrf: String,
    role: String,
    status: PrefixStatus,
    description: String,
    site_id: Option<String>,
) -> Result<IpPrefix, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            ipam_storage::update_prefix(
                conn,
                &id,
                &cidr,
                &vrf,
                &role,
                status,
                &description,
                site_id.as_deref(),
            )
            .map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_remove_ip_prefix(app: AppHandle, id: String) -> Result<(), String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            ipam_storage::remove_prefix(conn, &id).map_err(|error| error.to_string())
        })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn itops_create_ip_address(
    app: AppHandle,
    address: String,
    vrf: String,
    status: AddressStatus,
    dns_name: String,
    description: String,
    site_id: Option<String>,
    host_id: Option<String>,
    connection_id: Option<String>,
    rack_item_id: Option<String>,
) -> Result<IpAddressRecord, String> {
    let id = new_itops_id("ipaddr");
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            ipam_storage::create_address(
                conn,
                &id,
                &address,
                &vrf,
                status,
                &dns_name,
                &description,
                site_id.as_deref(),
                host_id.as_deref(),
                connection_id.as_deref(),
                rack_item_id.as_deref(),
            )
            .map_err(|error| error.to_string())
        })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn itops_update_ip_address(
    app: AppHandle,
    id: String,
    address: String,
    vrf: String,
    status: AddressStatus,
    dns_name: String,
    description: String,
    site_id: Option<String>,
    host_id: Option<String>,
    connection_id: Option<String>,
    rack_item_id: Option<String>,
) -> Result<IpAddressRecord, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            ipam_storage::update_address(
                conn,
                &id,
                &address,
                &vrf,
                status,
                &dns_name,
                &description,
                site_id.as_deref(),
                host_id.as_deref(),
                connection_id.as_deref(),
                rack_item_id.as_deref(),
            )
            .map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_remove_ip_address(app: AppHandle, id: String) -> Result<(), String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            ipam_storage::remove_address(conn, &id).map_err(|error| error.to_string())
        })
}

/// The lowest unassigned usable addresses in a prefix, for the "claim the next
/// free IP" affordance in the Address Record dialog.
#[tauri::command]
pub fn itops_suggest_free_addresses(
    app: AppHandle,
    cidr: String,
    vrf: String,
    limit: Option<u32>,
) -> Result<Vec<String>, String> {
    let limit = limit.unwrap_or(5).clamp(1, 64);
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            ipam_storage::suggest_free_addresses(conn, &cidr, &vrf, limit)
                .map_err(|error| error.to_string())
        })
}

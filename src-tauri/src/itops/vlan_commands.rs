// Tauri commands for the global IT Ops VLANs destination.

use tauri::{AppHandle, Manager};

use super::ids::new_itops_id;
use super::types::Vlan;
use super::vlan_storage;

#[tauri::command]
pub fn itops_list_vlans(app: AppHandle) -> Result<Vec<Vlan>, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            vlan_storage::list_vlans(conn).map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_create_vlan(
    app: AppHandle,
    vid: u16,
    name: String,
    description: String,
    site_id: Option<String>,
    accent: u8,
) -> Result<Vlan, String> {
    let id = new_itops_id("vlan");
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            vlan_storage::create_vlan(
                conn,
                &id,
                vid,
                &name,
                &description,
                site_id.as_deref(),
                accent,
            )
            .map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_update_vlan(
    app: AppHandle,
    id: String,
    vid: u16,
    name: String,
    description: String,
    site_id: Option<String>,
    accent: u8,
) -> Result<Vlan, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            vlan_storage::update_vlan(
                conn,
                &id,
                vid,
                &name,
                &description,
                site_id.as_deref(),
                accent,
            )
            .map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_remove_vlan(app: AppHandle, id: String) -> Result<(), String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            vlan_storage::remove_vlan(conn, &id).map_err(|error| error.to_string())
        })
}

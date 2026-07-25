// Tauri commands for the global IT Ops Network Map destination.

use tauri::{AppHandle, Manager};

use super::ids::new_itops_id;
use super::network_map_storage;
use super::types::{NetworkGraph, NetworkMap};

#[tauri::command]
pub fn itops_list_network_maps(app: AppHandle) -> Result<Vec<NetworkMap>, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            network_map_storage::list_maps(conn).map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_create_network_map(
    app: AppHandle,
    name: String,
    description: String,
    site_id: Option<String>,
    graph: Option<NetworkGraph>,
) -> Result<NetworkMap, String> {
    let id = new_itops_id("netmap");
    let graph = graph.unwrap_or_default();
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            network_map_storage::create_map(
                conn,
                &id,
                &name,
                &description,
                site_id.as_deref(),
                &graph,
            )
            .map_err(|error| error.to_string())
        })
}

/// Saves the whole map. The canvas is edited as one document, so there is no
/// per-node command to keep in sync with it.
#[tauri::command]
pub fn itops_update_network_map(
    app: AppHandle,
    id: String,
    name: String,
    description: String,
    site_id: Option<String>,
    graph: NetworkGraph,
) -> Result<NetworkMap, String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            network_map_storage::update_map(
                conn,
                &id,
                &name,
                &description,
                site_id.as_deref(),
                &graph,
            )
            .map_err(|error| error.to_string())
        })
}

#[tauri::command]
pub fn itops_remove_network_map(app: AppHandle, id: String) -> Result<(), String> {
    app.state::<crate::storage::Storage>()
        .with_connection_infallible(|conn| {
            network_map_storage::remove_map(conn, &id).map_err(|error| error.to_string())
        })
}

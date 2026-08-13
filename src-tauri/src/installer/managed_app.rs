use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedAppMarker {
    pub tool_id: String,
    pub version: Option<String>,
    pub installed_at: i64,
}

pub fn is_managed_app(tool_id: &str) -> bool {
    matches!(
        tool_id,
        "n8n"
            | "ollama"
            | "flowise"
            | "open-webui"
            | "langflow"
            | "excalidraw"
            | "bentopdf"
            | "openflowkit"
            | "openclaw"
    )
}

pub fn managed_app_install_dir(tool_id: &str) -> PathBuf {
    managed_apps_root().join(tool_id)
}

pub fn managed_app_binary_dir(tool_id: &str) -> PathBuf {
    managed_app_install_dir(tool_id).join("app")
}

pub fn managed_app_data_dir(tool_id: &str) -> PathBuf {
    managed_app_install_dir(tool_id).join("data")
}

pub fn managed_app_marker_path(tool_id: &str) -> PathBuf {
    managed_app_install_dir(tool_id).join(".kkterm-managed-app.json")
}

fn managed_apps_root() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("KKTerm").join("installer").join("apps")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requested_local_server_apps_are_managed() {
        for tool_id in [
            "n8n",
            "flowise",
            "open-webui",
            "langflow",
            "excalidraw",
            "bentopdf",
            "openflowkit",
            "openclaw",
        ] {
            assert!(
                is_managed_app(tool_id),
                "{tool_id} should use app-local storage"
            );
        }
    }
}

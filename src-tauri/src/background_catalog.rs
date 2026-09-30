//! The same lightweight metadata backs the picker and every tool transport.
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use std::sync::OnceLock;

pub fn catalog() -> &'static Vec<Value> {
    static CATALOG: OnceLock<Vec<Value>> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(include_str!("../../src/shared/dynamicBackgroundCatalog.json"))
        .expect("bundled dynamic background catalog is valid"))
}

fn normalize(value: &str) -> String {
    value.chars().flat_map(char::to_lowercase).filter(|c| c.is_alphanumeric()).collect()
}

pub fn resolve_dynamic(name: &str) -> Result<String, String> {
    // Exact canonical IDs win, including when two translated labels collide.
    if let Some(entry) = catalog().iter().find(|entry| entry["id"].as_str() == Some(name)) {
        return Ok(entry["id"].as_str().unwrap().to_string());
    }
    let key = normalize(name);
    if key.is_empty() { return Err("Dynamic background name must not be empty".into()); }
    let matches: Vec<&str> = catalog().iter().filter(|entry| {
        normalize(entry["id"].as_str().unwrap()) == key || entry["names"].as_object().unwrap()
            .values().any(|label| label.as_str().is_some_and(|label| normalize(label) == key))
    }).filter_map(|entry| entry["id"].as_str()).collect();
    match matches.as_slice() {
        [id] => Ok((*id).to_string()),
        [] => Err(format!("Unknown dynamic background {name:?}. List backgrounds and use a returned name or ID.")),
        _ => Err(format!("Ambiguous dynamic background {name:?}: {}. Use an exact ID.", matches.join(", "))),
    }
}

pub fn deserialize_dynamic<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let name = String::deserialize(deserializer)?;
    resolve_dynamic(&name).map_err(serde::de::Error::custom)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_and_ids_resolve_and_unknown_names_fail() {
        assert_eq!(resolve_dynamic("mistySea").unwrap(), "mistySea");
        assert_eq!(resolve_dynamic(" MISTY-SEA ").unwrap(), "mistySea");
        assert_eq!(resolve_dynamic(catalog().iter().find(|v| v["id"] == "mistySea").unwrap()["names"]["zh-TW"].as_str().unwrap()).unwrap(), "mistySea");
        assert!(resolve_dynamic("unknown-scene").is_err());
        assert!(resolve_dynamic("toString").is_err());
        assert!(resolve_dynamic(" ").is_err());
    }
    #[test]
    fn catalog_matches_renderer_validation_and_persists_canonical_ids() {
        let ids: Vec<&str> = catalog().iter().map(|v| v["id"].as_str().unwrap()).collect();
        assert_eq!(ids.into_iter().collect::<std::collections::BTreeSet<_>>(), crate::dashboard_validation::DYNAMIC_BACKGROUND_IDS.iter().copied().collect());
        let background: crate::dashboard_storage::DashboardBackground = serde_json::from_value(
            serde_json::json!({"kind":"dynamic", "dynamic":"Misty Sea"})).unwrap();
        assert_eq!(serde_json::to_value(background).unwrap()["dynamic"], "mistySea");
    }
}

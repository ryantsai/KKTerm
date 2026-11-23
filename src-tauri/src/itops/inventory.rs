use std::collections::HashSet;

use super::types::RackItemMetadata;

fn trim_string(value: &mut Option<String>) {
    *value = value
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
}

fn normalize_speed(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "1g" | "gigabit" => "gigabit".to_string(),
        "10g" => "10g".to_string(),
        "25g" => "25g".to_string(),
        "40g" => "40g".to_string(),
        "100g" => "100g".to_string(),
        _ => "custom".to_string(),
    }
}

pub fn normalize_metadata(mut metadata: RackItemMetadata) -> RackItemMetadata {
    if let Some(inventory) = &mut metadata.inventory {
        for value in [
            &mut inventory.cpu,
            &mut inventory.memory,
            &mut inventory.storage,
            &mut inventory.network,
            &mut inventory.raid,
        ] {
            trim_string(value);
        }
        for entry in &mut inventory.maintenance {
            entry.date = entry.date.trim().to_string();
            entry.notes = entry.notes.trim().to_string();
        }
        if *inventory == super::types::RackDeviceInventory::default() {
            metadata.inventory = None;
        }
    }
    trim_string(&mut metadata.accent);
    trim_string(&mut metadata.icon);
    trim_string(&mut metadata.notes);
    trim_string(&mut metadata.status);
    trim_string(&mut metadata.shell);
    trim_string(&mut metadata.expiry);
    trim_string(&mut metadata.vendor);
    trim_string(&mut metadata.form_factor);
    trim_string(&mut metadata.server_panel_style);
    trim_string(&mut metadata.kuaiguai_size);
    trim_string(&mut metadata.host_id);

    metadata.form_factor = metadata
        .form_factor
        .filter(|value| matches!(value.as_str(), "rack" | "tower"));
    trim_string(&mut metadata.width_fraction);
    metadata.width_fraction = metadata
        .width_fraction
        .filter(|value| matches!(value.as_str(), "half" | "quarter"));
    // A slot only means something on a fractional-width device; clamp it to
    // the slots that width offers (half: 0–1, quarter: 0–3).
    metadata.slot = match metadata.width_fraction.as_deref() {
        Some("half") => Some(metadata.slot.unwrap_or(0).min(1)),
        Some("quarter") => Some(metadata.slot.unwrap_or(0).min(3)),
        _ => None,
    };
    metadata.server_panel_style = metadata
        .server_panel_style
        .filter(|value| matches!(value.as_str(), "default" | "style1" | "style2"));

    if let Some(tags) = metadata.tags.take() {
        let tags = tags
            .into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect::<Vec<_>>();
        metadata.tags = (!tags.is_empty()).then_some(tags);
    }

    if let Some(ids) = metadata.connection_ids.take() {
        let mut seen = HashSet::new();
        let ids = ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty() && seen.insert(id.clone()))
            .collect::<Vec<_>>();
        metadata.connection_ids = (!ids.is_empty()).then_some(ids);
    }

    if let Some(ports) = metadata.network_ports.take() {
        let ports = ports
            .into_iter()
            .filter_map(|mut port| {
                port.name = port.name.trim().to_string();
                if port.name.is_empty() {
                    return None;
                }
                port.speed = normalize_speed(&port.speed);
                trim_string(&mut port.state);
                trim_string(&mut port.oid);
                trim_string(&mut port.note);
                Some(port)
            })
            .collect::<Vec<_>>();
        metadata.network_ports = (!ports.is_empty()).then_some(ports);
    }

    if let Some(mut snmp) = metadata.snmp.take() {
        snmp.target = snmp.target.trim().to_string();
        trim_string(&mut snmp.oid);
        trim_string(&mut snmp.community_secret_ref);
        trim_string(&mut snmp.last_refreshed_at);
        trim_string(&mut snmp.last_error);
        metadata.snmp = (!snmp.target.is_empty()).then_some(snmp);
    }

    // A 0 W draw carries no information for the power heatmap; store as unset.
    metadata.power_w = metadata.power_w.filter(|watts| *watts > 0);
    metadata.rack_top_corner = metadata.rack_top_corner.filter(|corner| *corner <= 3);
    metadata.rack_top_facing = metadata.rack_top_facing.filter(|facing| *facing <= 3);

    metadata
}

/// Validate before writing, rather than silently truncating service history.
pub fn validate_inventory(metadata: &RackItemMetadata) -> Result<(), String> {
    let Some(inventory) = &metadata.inventory else {
        return Ok(());
    };
    for value in [
        &inventory.cpu,
        &inventory.memory,
        &inventory.storage,
        &inventory.network,
        &inventory.raid,
    ]
    .into_iter()
    .flatten()
    {
        if value.chars().count() > 500 {
            return Err("Hardware specifications must not exceed 500 characters per field".into());
        }
    }
    if inventory.maintenance.len() > 100 {
        return Err("At most 100 maintenance entries are supported per device".into());
    }
    let mut ids = HashSet::new();
    for entry in &inventory.maintenance {
        if entry.id.trim().is_empty() || entry.id.chars().count() > 128 || !ids.insert(&entry.id) {
            return Err("Maintenance entries must have unique non-empty identifiers".into());
        }
        let valid_date = time::Date::parse(
            &entry.date,
            time::macros::format_description!("[year]-[month]-[day]"),
        )
        .is_ok_and(|date| date.year() > 0);
        if entry.date.len() != 10 || !valid_date {
            return Err("Maintenance dates must be valid YYYY-MM-DD dates".into());
        }
        if entry.notes.trim().is_empty() || entry.notes.chars().count() > 2000 {
            return Err("Maintenance notes must contain 1 to 2000 characters".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod inventory_tests {
    use super::{normalize_metadata, validate_inventory};
    use crate::itops::types::RackItemMetadata;

    #[test]
    fn normalizes_legacy_rack_inventory_metadata() {
        let metadata: RackItemMetadata = serde_json::from_value(serde_json::json!({
            "tags": [" core ", "", "edge"],
            "connectionIds": ["conn-1", "conn-1", "conn-2"],
            "networkPorts": ["1:gigabit", "2:10g"],
            "snmp": "public@192.0.2.10:1.3.6.1.2.1.2",
            "vendor": "Dell",
            "formFactor": "tower",
            "serverPanelStyle": "style1",
            "rackTopCorner": 3,
            "rackTopFacing": 1
        }))
        .expect("legacy metadata should deserialize");

        let normalized = normalize_metadata(metadata);

        assert_eq!(normalized.tags.unwrap(), vec!["core", "edge"]);
        assert_eq!(normalized.connection_ids.unwrap(), vec!["conn-1", "conn-2"]);
        assert_eq!(normalized.network_ports.unwrap()[1].speed, "10g");
        assert_eq!(normalized.snmp.unwrap().target, "192.0.2.10");
        assert_eq!(normalized.vendor.unwrap(), "Dell");
        assert_eq!(normalized.form_factor.as_deref(), Some("tower"));
        assert_eq!(normalized.server_panel_style.as_deref(), Some("style1"));
        assert_eq!(normalized.rack_top_corner, Some(3));
        assert_eq!(normalized.rack_top_facing, Some(1));
    }

    #[test]
    fn hardware_inventory_is_optional_and_normalizes_without_losing_history() {
        let old: RackItemMetadata = serde_json::from_str("{\"vendor\":\"Dell\"}").unwrap();
        assert!(old.inventory.is_none());
        assert!(validate_inventory(&old).is_ok());
        let metadata = normalize_metadata(serde_json::from_value(serde_json::json!({
            "inventory": {"cpu": " 2 × Xeon ", "memory": " ", "raid": " RAID 10 ",
                "maintenance": [{"id": "service-1", "date": " 2024-02-29 ", "notes": " Replaced failed disk "}]}
        })).unwrap());
        assert!(validate_inventory(&metadata).is_ok());
        let inventory = metadata.inventory.unwrap();
        assert_eq!(inventory.cpu.as_deref(), Some("2 × Xeon"));
        assert!(inventory.memory.is_none());
        assert_eq!(inventory.maintenance[0].date, "2024-02-29");
        assert_eq!(inventory.maintenance[0].notes, "Replaced failed disk");
        assert_eq!(inventory.maintenance[0].id, "service-1");
        let empty =
            normalize_metadata(serde_json::from_str("{\"inventory\":{\"cpu\":\" \"}}").unwrap());
        assert!(empty.inventory.is_none());
    }

    #[test]
    fn invalid_hardware_inventory_is_rejected_instead_of_truncated() {
        use serde_json::json;
        let entry = json!({"id":"e1", "date":"2024-02-29", "notes":"Replaced RAM"});
        for inventory in [
            json!({"cpu":"x".repeat(501)}),
            json!({"maintenance": vec![entry.clone(); 101]}),
            json!({"maintenance": [entry.clone(), entry.clone()]}),
            json!({"maintenance": [{"id":"", "date":"2024-02-29", "notes":"Work"}]}),
            json!({"maintenance": [{"id":"e1", "date":"2025-02-29", "notes":"Work"}]}),
            json!({"maintenance": [{"id":"e1", "date":"0000-01-01", "notes":"Work"}]}),
            json!({"maintenance": [{"id":"e1", "date":"2024-02-29", "notes":"  "}]}),
            json!({"maintenance": [{"id":"e1", "date":"2024-02-29", "notes":"x".repeat(2001)}]}),
        ] {
            let metadata =
                normalize_metadata(serde_json::from_value(json!({"inventory":inventory})).unwrap());
            assert!(validate_inventory(&metadata).is_err());
        }
    }
}

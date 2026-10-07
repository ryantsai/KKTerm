-- Operator-defined IPAM metadata. Values never contain plaintext credentials.
CREATE TABLE IF NOT EXISTS itops_custom_fields (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    record_kind TEXT NOT NULL CHECK(record_kind IN ('prefix', 'address', 'vlan')),
    field_type TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS itops_custom_field_values (
    id TEXT PRIMARY KEY,
    field_id TEXT NOT NULL REFERENCES itops_custom_fields(id) ON DELETE CASCADE,
    record_kind TEXT NOT NULL CHECK(record_kind IN ('prefix', 'address', 'vlan')),
    record_id TEXT NOT NULL,
    value_json TEXT NOT NULL,
    UNIQUE(field_id, record_id)
);
CREATE INDEX IF NOT EXISTS idx_itops_custom_field_owner
    ON itops_custom_field_values(record_kind, record_id);
CREATE TRIGGER IF NOT EXISTS itops_custom_field_prefix_delete AFTER DELETE ON itops_ip_prefixes BEGIN
    DELETE FROM itops_custom_field_values WHERE record_kind = 'prefix' AND record_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS itops_custom_field_address_delete AFTER DELETE ON itops_ip_address_records BEGIN
    DELETE FROM itops_custom_field_values WHERE record_kind = 'address' AND record_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS itops_custom_field_vlan_delete AFTER DELETE ON itops_vlans BEGIN
    DELETE FROM itops_custom_field_values WHERE record_kind = 'vlan' AND record_id = OLD.id;
END;


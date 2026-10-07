use super::*;
use serde_json::json;

fn field(id: &str, kind: &str, field_type: &str) -> FieldDefinition {
    FieldDefinition {
        id: id.into(),
        name: id.into(),
        record_kind: kind.into(),
        field_type: field_type.into(),
        options: vec![],
    }
}

fn fixture() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
        CREATE TABLE itops_ip_prefixes (id TEXT PRIMARY KEY, description TEXT DEFAULT '');
        CREATE TABLE itops_ip_address_records (id TEXT PRIMARY KEY);
        CREATE TABLE itops_vlans (id TEXT PRIMARY KEY);
        INSERT INTO itops_ip_prefixes VALUES ('p', 'old');",
    )
    .unwrap();
    conn.execute_batch(include_str!("custom_fields_schema.sql"))
        .unwrap();
    conn
}

#[test]
fn validates_types_dates_and_credential_references_without_accepting_secrets() {
    for (kind, value) in [
        ("number", json!(0)),
        ("boolean", json!(false)),
        ("date", json!("2028-02-29")),
        ("text", json!("ISP-0123")),
        ("multiline", json!("Contact\nTelephone")),
        ("url", json!("https://example.com")),
        (
            "credential",
            json!({"kind":"credential", "credentialId":"c"}),
        ),
        (
            "link",
            json!({"kind":"networkNode", "mapId":"m", "nodeId":"n"}),
        ),
        ("link", json!({"kind":"connection", "connectionId":"c"})),
        ("link", json!({"kind":"rack", "siteId":"s", "rackId":"r"})),
        (
            "link",
            json!({"kind":"rackItem", "siteId":"s", "rackId":"r", "rackItemId":"d"}),
        ),
    ] {
        validate_value(&field("f", "prefix", kind), &value).unwrap();
    }
    for (kind, value) in [
        ("number", json!("10")),
        ("boolean", json!("false")),
        ("date", json!("2026-02-29")),
        ("date", json!("2026-04-31")),
        ("date", json!("0000-01-01")),
        ("url", json!("javascript:alert(1)")),
        ("url", json!("file:///secret")),
        ("credential", json!("password")),
        (
            "credential",
            json!({"kind":"credential", "credentialId":"c", "password":"secret"}),
        ),
        ("link", json!({"kind":"networkNode", "nodeId":"n"})),
        ("link", json!({"kind":"connection", "connectionId":""})),
    ] {
        assert!(
            validate_value(&field("f", "prefix", kind), &value).is_err(),
            "{kind}: {value}"
        );
    }
}

#[test]
fn record_and_values_commit_atomically_and_older_callers_preserve_values() {
    let conn = fixture();
    set_fields(
        &conn,
        vec![
            field("n", "prefix", "number"),
            field("b", "prefix", "boolean"),
        ],
    )
    .unwrap();
    with_record_values(
        &conn,
        "prefix",
        "p",
        Some(BTreeMap::from([
            ("n".into(), json!(0)),
            ("b".into(), json!(false)),
        ])),
        |conn| {
            conn.execute(
                "UPDATE itops_ip_prefixes SET description='new' WHERE id='p'",
                [],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(snapshot(&conn).unwrap().values.len(), 2);
    let failed = with_record_values(
        &conn,
        "prefix",
        "p",
        Some(BTreeMap::from([("n".into(), json!("not a number"))])),
        |conn| {
            conn.execute(
                "UPDATE itops_ip_prefixes SET description='bad' WHERE id='p'",
                [],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        },
    );
    assert!(failed.is_err());
    assert_eq!(
        conn.query_row("SELECT description FROM itops_ip_prefixes", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap(),
        "new"
    );
    conn.execute_batch("CREATE TRIGGER fail_value BEFORE UPDATE ON itops_custom_field_values BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    assert!(
        with_record_values(
            &conn,
            "prefix",
            "p",
            Some(BTreeMap::from([("n".into(), json!(100))])),
            |conn| {
                conn.execute(
                    "UPDATE itops_ip_prefixes SET description='bad' WHERE id='p'",
                    [],
                )
                .map_err(|e| e.to_string())?;
                Ok(())
            }
        )
        .is_err()
    );
    assert_eq!(
        conn.query_row("SELECT description FROM itops_ip_prefixes", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap(),
        "new"
    );
    conn.execute_batch("DROP TRIGGER fail_value;").unwrap();
    with_record_values(&conn, "prefix", "p", None, |_| Ok(())).unwrap();
    assert_eq!(snapshot(&conn).unwrap().values.len(), 2);
    with_record_values(
        &conn,
        "prefix",
        "p",
        Some(BTreeMap::from([("n".into(), Value::Null)])),
        |_| Ok(()),
    )
    .unwrap();
    assert_eq!(snapshot(&conn).unwrap().values.len(), 1);
    assert!(
        with_record_values(
            &conn,
            "address",
            "p",
            Some(BTreeMap::from([("b".into(), json!(true))])),
            |_| Ok(())
        )
        .is_err()
    );
}

#[test]
fn definitions_protect_used_choices_and_cascade_values_on_deletion() {
    let conn = fixture();
    let mut choice = field("provider", "prefix", "select");
    choice.options = vec!["ISP A".into(), "ISP B".into()];
    set_fields(&conn, vec![choice.clone()]).unwrap();
    with_record_values(
        &conn,
        "prefix",
        "p",
        Some(BTreeMap::from([("provider".into(), json!("ISP A"))])),
        |_| Ok(()),
    )
    .unwrap();
    let mut changed = choice.clone();
    changed.options = vec!["ISP B".into()];
    assert!(set_fields(&conn, vec![changed]).is_err());
    let mut changed = choice.clone();
    changed.field_type = "text".into();
    assert!(set_fields(&conn, vec![changed]).is_err());
    assert!(set_fields(&conn, vec![choice.clone(), choice]).is_err());
    set_fields(&conn, vec![]).unwrap();
    assert!(snapshot(&conn).unwrap().values.is_empty());
}

#[test]
fn definition_limits_count_unicode_characters() {
    let conn = fixture();
    let mut definition = field("unicode", "prefix", "select");
    definition.name = "欄".repeat(120);
    definition.options = vec!["選".repeat(120)];
    set_fields(&conn, vec![definition.clone()]).unwrap();
    definition.name.push('位');
    assert!(set_fields(&conn, vec![definition]).is_err());
}

#[test]
fn value_limits_count_unicode_characters_instead_of_utf8_bytes() {
    for kind in ["text", "multiline"] {
        let definition = field("f", "prefix", kind);
        validate_value(&definition, &json!("欄😀".repeat(8192))).unwrap();
        assert!(validate_value(&definition, &json!("欄".repeat(16385))).is_err());
    }
    let definition = field("f", "prefix", "url");
    validate_value(&definition, &json!(format!("https://example.com/{}", "欄".repeat(2028)))).unwrap();
    assert!(validate_value(&definition, &json!(format!("https://example.com/{}", "欄".repeat(2030)))).is_err());
}

#[test]
fn deleting_any_record_kind_cleans_up_its_custom_values() {
    let conn = fixture();
    conn.execute_batch(
        "INSERT INTO itops_ip_address_records VALUES ('a'); INSERT INTO itops_vlans VALUES ('v');",
    )
    .unwrap();
    set_fields(
        &conn,
        vec![
            field("fp", "prefix", "text"),
            field("fa", "address", "text"),
            field("fv", "vlan", "text"),
        ],
    )
    .unwrap();
    for (kind, id, field_id) in [
        ("prefix", "p", "fp"),
        ("address", "a", "fa"),
        ("vlan", "v", "fv"),
    ] {
        with_record_values(
            &conn,
            kind,
            id,
            Some(BTreeMap::from([(field_id.into(), json!("circuit"))])),
            |_| Ok(()),
        )
        .unwrap();
    }
    for (kind, id) in [("prefix", "p"), ("address", "a"), ("vlan", "v")] {
        conn.execute(
            &format!("DELETE FROM {} WHERE id=?", owner_table(kind).unwrap()),
            [id],
        )
        .unwrap();
        assert!(
            !snapshot(&conn)
                .unwrap()
                .values
                .iter()
                .any(|entry| entry.record_kind == kind)
        );
    }
}

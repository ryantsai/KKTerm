//! Explicit, bounded network discovery for selected IPAM Prefixes.
//!
//! A host is considered used when any independent signal answers: ICMP echo,
//! an SNMPv2c sysDescr request using the conventional read-only `public`
//! community, or a TCP full-connect to a small common-management port set.
//! Results are transient and are persisted only when the operator imports them.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::Duration,
};

use futures::{StreamExt, stream};
use hickory_resolver::{TokioResolver, proto::rr::RData};
use rusqlite::{Connection as SqliteConnection, params_from_iter};
use tokio::net::UdpSocket;

use crate::net::{dns, ping, scan};

use super::{
    ipv4::{self, Prefix},
    types::{IpamDeviceType, IpamImportAddressInput, IpamScanResult},
};

pub const MAX_SCAN_ADDRESSES: usize = 4096;
const ADDRESS_CONCURRENCY: usize = 32;
const PROBE_TIMEOUT_MS: u64 = 650;
const IMPORT_DNS_CONCURRENCY: usize = 64;
const IMPORT_DNS_BUDGET_SECS: u64 = 30;
const COMMON_PORTS: [u16; 16] = [
    22, 23, 53, 80, 161, 443, 445, 515, 554, 631, 3389, 5060, 5061, 5985, 5986, 9100,
];
const SYS_DESCR_OID: &[u8] = &[0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00];
const SYS_OBJECT_ID_OID: &[u8] = &[0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x02, 0x00];
const SYS_NAME_OID: &[u8] = &[0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x05, 0x00];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct SnmpIdentity {
    description: String,
    object_id: String,
    name: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ScanTarget {
    address: String,
    prefix_id: String,
    cidr: String,
    vrf: String,
    site_id: Option<String>,
    documented: bool,
}

pub async fn scan_targets(targets: Vec<ScanTarget>) -> Vec<IpamScanResult> {
    let resolver = dns::build_resolver().ok().map(Arc::new);
    let results = stream::iter(
        targets
            .into_iter()
            .map(|target| {
                let resolver = resolver.clone();
                async move { probe_target(target, resolver).await }
            }),
    )
    .buffer_unordered(ADDRESS_CONCURRENCY)
    .filter_map(|result| async move { result })
    .collect::<Vec<_>>()
    .await;

    let mut results = results;
    results.sort_by_key(|result| {
        (
            result.vrf.clone(),
            ipv4::parse_address(&result.address).unwrap_or_default(),
            result.prefix_id.clone(),
        )
    });
    results
}

/// Best-effort PTR enrichment for file import. Existing file hostnames always
/// win, and the overall budget prevents a large import from waiting on every
/// unresponsive DNS server.
pub async fn resolve_import_hostnames(
    mut addresses: Vec<IpamImportAddressInput>,
) -> Vec<IpamImportAddressInput> {
    let Some(resolver) = dns::build_resolver().ok().map(Arc::new) else {
        return addresses;
    };
    let targets = addresses
        .iter()
        .filter(|input| input.dns_name.trim().is_empty())
        .filter_map(|input| {
            input
                .address
                .parse::<std::net::Ipv4Addr>()
                .ok()
                .map(|address| address.to_string())
        })
        .collect::<HashSet<_>>();
    if targets.is_empty() {
        return addresses;
    }

    let resolved = Arc::new(Mutex::new(HashMap::<String, String>::new()));
    let lookups = stream::iter(targets).for_each_concurrent(IMPORT_DNS_CONCURRENCY, |address| {
        let resolver = Arc::clone(&resolver);
        let resolved = Arc::clone(&resolved);
        async move {
            if let Some(hostname) = probe_reverse_dns(&address, &resolver, PROBE_TIMEOUT_MS).await {
                if let Ok(mut names) = resolved.lock() {
                    names.insert(address, hostname);
                }
            }
        }
    });
    let _ = tokio::time::timeout(Duration::from_secs(IMPORT_DNS_BUDGET_SECS), lookups).await;

    if let Ok(names) = resolved.lock() {
        apply_resolved_hostnames(&mut addresses, &names);
    }
    addresses
}

fn apply_resolved_hostnames(
    addresses: &mut [IpamImportAddressInput],
    names: &HashMap<String, String>,
) {
    for input in addresses {
        if input.dns_name.trim().is_empty() {
            if let Some(hostname) = names.get(input.address.trim()) {
                input.dns_name = hostname.clone();
            }
        }
    }
}

pub(crate) fn load_targets(
    conn: &SqliteConnection,
    prefix_ids: &[String],
) -> Result<Vec<ScanTarget>, String> {
    let ids = prefix_ids
        .iter()
        .map(|id| id.trim())
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>();
    if ids.is_empty() {
        return Err("Select at least one IP Prefix to scan".to_string());
    }

    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let mut statement = conn
        .prepare(&format!(
            "SELECT id, cidr, vrf, site_id FROM itops_ip_prefixes
             WHERE id IN ({placeholders}) ORDER BY vrf, cidr"
        ))
        .map_err(|error| error.to_string())?;
    let mut prefixes = statement
        .query_map(params_from_iter(ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if prefixes.len() != ids.len() {
        return Err("One or more selected IP Prefixes no longer exist".to_string());
    }
    prefixes.sort_by_key(|(_, cidr, _, _)| {
        std::cmp::Reverse(Prefix::parse(cidr).map_or(0, |prefix| prefix.length))
    });

    let documented = load_documented_addresses(conn)?;
    let mut seen = HashSet::new();
    let mut targets = Vec::new();
    for (prefix_id, cidr, vrf, site_id) in prefixes {
        let prefix =
            Prefix::parse(&cidr).ok_or_else(|| format!("'{cidr}' is not a valid IPv4 prefix"))?;
        let (first, last) = usable_bounds(prefix);
        for value in first..=last {
            // Overlap within one VRF is scanned once; prefer the most-specific
            // selected Prefix so its optional Site metadata follows import.
            let key = (vrf.clone(), value);
            if seen.contains(&key) {
                continue;
            }
            if targets.len() >= MAX_SCAN_ADDRESSES {
                return Err(format!(
                    "Selected Prefixes contain more than {MAX_SCAN_ADDRESSES} usable addresses"
                ));
            }
            seen.insert(key);
            targets.push(ScanTarget {
                address: ipv4::format_address(value),
                prefix_id: prefix_id.clone(),
                cidr: cidr.clone(),
                vrf: vrf.clone(),
                site_id: site_id.clone(),
                documented: documented.contains(&(vrf.clone(), value)),
            });
        }
    }
    Ok(targets)
}

fn load_documented_addresses(conn: &SqliteConnection) -> Result<HashSet<(String, u32)>, String> {
    let mut statement = conn
        .prepare("SELECT vrf, address FROM itops_ip_address_records")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut documented = HashSet::new();
    for row in rows {
        let (vrf, address) = row.map_err(|error| error.to_string())?;
        if let Some(value) = ipv4::parse_address(&address) {
            documented.insert((vrf, value));
        }
    }
    Ok(documented)
}

fn usable_bounds(prefix: Prefix) -> (u32, u32) {
    if prefix.length >= 31 {
        (prefix.network, prefix.last())
    } else {
        (prefix.network + 1, prefix.last() - 1)
    }
}

async fn probe_target(
    target: ScanTarget,
    resolver: Option<Arc<TokioResolver>>,
) -> Option<IpamScanResult> {
    let address = target.address.clone();
    let ping_probe = ping::probe_once(&address, PROBE_TIMEOUT_MS);
    let snmp_probe = probe_snmp(&address, PROBE_TIMEOUT_MS);
    let port_probe = probe_common_ports(&address);
    let (ping_rtt, snmp, open_ports) = tokio::join!(ping_probe, snmp_probe, port_probe);
    if ping_rtt.is_none() && snmp.is_none() && open_ports.is_empty() {
        return None;
    }
    let hostname = match resolver {
        Some(resolver) => probe_reverse_dns(&address, &resolver, PROBE_TIMEOUT_MS)
            .await
            .or_else(|| snmp.as_ref().and_then(|identity| normalize_hostname(&identity.name)))
            .unwrap_or_default(),
        None => snmp
            .as_ref()
            .and_then(|identity| normalize_hostname(&identity.name))
            .unwrap_or_default(),
    };
    let (device_type, device_model) = infer_device_identity(snmp.as_ref(), &open_ports);
    Some(IpamScanResult {
        address,
        prefix_id: target.prefix_id,
        cidr: target.cidr,
        vrf: target.vrf,
        site_id: target.site_id,
        hostname,
        device_type,
        device_model,
        ping: ping_rtt.is_some(),
        snmp: snmp.is_some(),
        open_ports,
        documented: target.documented,
    })
}

async fn probe_common_ports(host: &str) -> Vec<u16> {
    let host = Arc::new(host.to_string());
    let mut open = stream::iter(COMMON_PORTS.into_iter().map(|port| {
        let host = Arc::clone(&host);
        async move {
            scan::tcp_check(&host, port, Some(PROBE_TIMEOUT_MS))
                .await
                .open
                .then_some(port)
        }
    }))
    .buffer_unordered(COMMON_PORTS.len())
    .filter_map(|port| async move { port })
    .collect::<Vec<_>>()
    .await;
    open.sort_unstable();
    open
}

async fn probe_reverse_dns(
    host: &str,
    resolver: &TokioResolver,
    timeout_ms: u64,
) -> Option<String> {
    let octets = host
        .parse::<std::net::Ipv4Addr>()
        .ok()?
        .octets();
    let reverse_name = format!(
        "{}.{}.{}.{}.in-addr.arpa.",
        octets[3], octets[2], octets[1], octets[0]
    );
    let lookup = tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        resolver.reverse_lookup(reverse_name),
    )
    .await
    .ok()?
    .ok()?;
    lookup.answers().iter().find_map(|record| match &record.data {
        RData::PTR(name) => normalize_hostname(&name.0.to_utf8()),
        _ => None,
    })
}

fn normalize_hostname(value: &str) -> Option<String> {
    let hostname = value.trim().trim_end_matches('.').trim();
    (!hostname.is_empty()).then(|| hostname.to_string())
}

fn infer_device_identity(
    snmp: Option<&SnmpIdentity>,
    open_ports: &[u16],
) -> (Option<IpamDeviceType>, String) {
    let description = snmp
        .map(|identity| identity.description.trim())
        .unwrap_or_default();
    let lower = description.to_lowercase();
    let contains_any = |patterns: &[&str]| patterns.iter().any(|pattern| lower.contains(pattern));

    let described_type = if contains_any(&[
        "printer",
        "laserjet",
        "jetdirect",
        "xerox",
        "brother",
        "epson",
    ]) {
        Some(IpamDeviceType::Printer)
    } else if contains_any(&["camera", "ipcam", "hikvision", "dahua", "axis"]) {
        Some(IpamDeviceType::Camera)
    } else if contains_any(&["voip", "ip phone", "telephone"]) {
        Some(IpamDeviceType::Voip)
    } else if contains_any(&["synology", "diskstation", "qnap", "storage", " nas "]) {
        Some(IpamDeviceType::Storage)
    } else if contains_any(&[
        "firewall",
        "fortigate",
        "fortios",
        "palo alto",
        "pfsense",
        "checkpoint",
    ]) {
        Some(IpamDeviceType::Firewall)
    } else if contains_any(&["access point", "wireless ap", "unifi ap"]) {
        Some(IpamDeviceType::AccessPoint)
    } else if contains_any(&["switch", "catalyst", "procurve"]) {
        Some(IpamDeviceType::Switch)
    } else if contains_any(&["router", "routing", "routeros", "mikrotik"]) {
        Some(IpamDeviceType::Router)
    } else if contains_any(&["windows server", " vmware esxi", " server"]) {
        Some(IpamDeviceType::Server)
    } else if contains_any(&["windows 10", "windows 11", "macos"]) {
        Some(IpamDeviceType::Desktop)
    } else {
        None
    };
    let device_type = described_type.or_else(|| {
        if open_ports.iter().any(|port| matches!(port, 515 | 631 | 9100)) {
            Some(IpamDeviceType::Printer)
        } else if open_ports.contains(&554) {
            Some(IpamDeviceType::Camera)
        } else if open_ports.iter().any(|port| matches!(port, 5060 | 5061)) {
            Some(IpamDeviceType::Voip)
        } else {
            None
        }
    });

    (device_type, description.to_string())
}

async fn probe_snmp(host: &str, timeout_ms: u64) -> Option<SnmpIdentity> {
    let Ok(target) = format!("{host}:161").parse::<std::net::SocketAddr>() else {
        return None;
    };
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0").await else {
        return None;
    };
    if socket.connect(target).await.is_err() {
        return None;
    }
    let request = snmp_identity_request(rand::random::<i32>());
    if socket.send(&request).await.is_err() {
        return None;
    }
    let mut response = [0u8; 1500];
    let size = tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        socket.recv(&mut response),
    )
    .await
    .ok()?
    .ok()?;
    parse_snmp_identity_response(&response[..size])
}

fn ber_tlv(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut value = vec![tag];
    if content.len() < 128 {
        value.push(content.len() as u8);
    } else {
        let length = content.len();
        if length <= u8::MAX as usize {
            value.extend_from_slice(&[0x81, length as u8]);
        } else {
            value.extend_from_slice(&[0x82, (length >> 8) as u8, length as u8]);
        }
    }
    value.extend_from_slice(content);
    value
}

fn snmp_varbind(oid: &[u8], value: &[u8]) -> Vec<u8> {
    let mut content = ber_tlv(0x06, oid);
    content.extend_from_slice(value);
    ber_tlv(0x30, &content)
}

fn snmp_identity_request(request_id: i32) -> Vec<u8> {
    // One SNMPv2c GetRequest asks for sysDescr.0, sysObjectID.0, and sysName.0.
    // RFC 1213 defines these as the system description, vendor identity, and
    // administratively assigned hostname respectively.
    let mut varbinds = Vec::new();
    for oid in [SYS_DESCR_OID, SYS_OBJECT_ID_OID, SYS_NAME_OID] {
        varbinds.extend(snmp_varbind(oid, &[0x05, 0x00]));
    }
    let mut pdu = vec![
        0x02,
        0x04,
        (request_id >> 24) as u8,
        (request_id >> 16) as u8,
        (request_id >> 8) as u8,
        request_id as u8,
        0x02,
        0x01,
        0x00,
        0x02,
        0x01,
        0x00,
    ];
    pdu.extend(ber_tlv(0x30, &varbinds));
    let pdu = ber_tlv(0xa0, &pdu);

    let mut message = vec![0x02, 0x01, 0x01, 0x04, 0x06];
    message.extend_from_slice(b"public");
    message.extend(pdu);
    ber_tlv(0x30, &message)
}

fn read_tlv<'a>(bytes: &'a [u8], cursor: &mut usize) -> Option<(u8, &'a [u8])> {
    let tag = *bytes.get(*cursor)?;
    *cursor += 1;
    let first = *bytes.get(*cursor)?;
    *cursor += 1;
    let length = if first & 0x80 == 0 {
        usize::from(first)
    } else {
        let count = usize::from(first & 0x7f);
        if count == 0 || count > 2 {
            return None;
        }
        let mut length = 0usize;
        for _ in 0..count {
            length = (length << 8) | usize::from(*bytes.get(*cursor)?);
            *cursor += 1;
        }
        length
    };
    let end = cursor.checked_add(length)?;
    let value = bytes.get(*cursor..end)?;
    *cursor = end;
    Some((tag, value))
}

fn format_oid(bytes: &[u8]) -> String {
    let Some((&first, rest)) = bytes.split_first() else {
        return String::new();
    };
    let mut parts = vec![u32::from(first / 40), u32::from(first % 40)];
    let mut value = 0u32;
    for byte in rest {
        value = (value << 7) | u32::from(byte & 0x7f);
        if byte & 0x80 == 0 {
            parts.push(value);
            value = 0;
        }
    }
    parts
        .into_iter()
        .map(|part| part.to_string())
        .collect::<Vec<_>>()
        .join(".")
}

fn parse_snmp_identity_response(bytes: &[u8]) -> Option<SnmpIdentity> {
    let mut cursor = 0;
    let (tag, message) = read_tlv(bytes, &mut cursor)?;
    if tag != 0x30 {
        return None;
    }
    cursor = 0;
    read_tlv(message, &mut cursor)?; // version
    read_tlv(message, &mut cursor)?; // community
    let (pdu_tag, pdu) = read_tlv(message, &mut cursor)?;
    if pdu_tag != 0xa2 {
        return None;
    }
    cursor = 0;
    read_tlv(pdu, &mut cursor)?; // request id
    read_tlv(pdu, &mut cursor)?; // error status
    read_tlv(pdu, &mut cursor)?; // error index
    let (list_tag, varbinds) = read_tlv(pdu, &mut cursor)?;
    if list_tag != 0x30 {
        return None;
    }

    let mut identity = SnmpIdentity::default();
    cursor = 0;
    while cursor < varbinds.len() {
        let (binding_tag, binding) = read_tlv(varbinds, &mut cursor)?;
        if binding_tag != 0x30 {
            return None;
        }
        let mut binding_cursor = 0;
        let (oid_tag, oid) = read_tlv(binding, &mut binding_cursor)?;
        let (value_tag, value) = read_tlv(binding, &mut binding_cursor)?;
        if oid_tag != 0x06 {
            continue;
        }
        match oid {
            SYS_DESCR_OID if value_tag == 0x04 => {
                identity.description = String::from_utf8_lossy(value).trim().to_string();
            }
            SYS_OBJECT_ID_OID if value_tag == 0x06 => {
                identity.object_id = format_oid(value);
            }
            SYS_NAME_OID if value_tag == 0x04 => {
                identity.name = String::from_utf8_lossy(value).trim().to_string();
            }
            _ => {}
        }
    }
    Some(identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE itops_ip_prefixes (
                id TEXT PRIMARY KEY, cidr TEXT NOT NULL, vrf TEXT NOT NULL DEFAULT '',
                site_id TEXT
             );
             CREATE TABLE itops_ip_address_records (
                id TEXT PRIMARY KEY, address TEXT NOT NULL, vrf TEXT NOT NULL DEFAULT ''
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn selected_prefixes_expand_to_usable_addresses_and_keep_optional_site() {
        let conn = database();
        conn.execute(
            "INSERT INTO itops_ip_prefixes (id, cidr, vrf, site_id)
             VALUES ('p1', '192.0.2.0/30', '', NULL)",
            [],
        )
        .unwrap();
        let targets = load_targets(&conn, &["p1".to_string()]).unwrap();
        assert_eq!(
            targets
                .iter()
                .map(|target| target.address.as_str())
                .collect::<Vec<_>>(),
            ["192.0.2.1", "192.0.2.2"]
        );
        assert!(targets.iter().all(|target| target.site_id.is_none()));
    }

    #[test]
    fn scan_rejects_more_than_the_bounded_address_budget() {
        let conn = database();
        conn.execute(
            "INSERT INTO itops_ip_prefixes (id, cidr, vrf, site_id)
             VALUES ('p1', '10.0.0.0/19', '', NULL)",
            [],
        )
        .unwrap();
        let error = load_targets(&conn, &["p1".to_string()]).unwrap_err();
        assert!(error.contains(&MAX_SCAN_ADDRESSES.to_string()));
    }

    #[test]
    fn snmp_request_collects_the_mib_ii_identity_fields() {
        let packet = snmp_identity_request(0x01020304);
        assert_eq!(packet[0], 0x30);
        assert!(packet.windows(6).any(|window| window == b"public"));
        for oid in [SYS_DESCR_OID, SYS_OBJECT_ID_OID, SYS_NAME_OID] {
            assert!(packet.windows(oid.len()).any(|window| window == oid));
        }
    }

    #[test]
    fn parses_snmp_identity_values_from_one_response() {
        let bindings = [
            snmp_varbind(SYS_DESCR_OID, &ber_tlv(0x04, b"Cisco Catalyst C9300")),
            snmp_varbind(
                SYS_OBJECT_ID_OID,
                &ber_tlv(0x06, &[0x2b, 0x06, 0x01, 0x04, 0x01, 0x09, 0x01]),
            ),
            snmp_varbind(SYS_NAME_OID, &ber_tlv(0x04, b"core-sw-01.example.com")),
        ]
        .concat();
        let mut pdu = [
            ber_tlv(0x02, &[0x01]),
            ber_tlv(0x02, &[0x00]),
            ber_tlv(0x02, &[0x00]),
            ber_tlv(0x30, &bindings),
        ]
        .concat();
        pdu = ber_tlv(0xa2, &pdu);
        let mut message = [ber_tlv(0x02, &[0x01]), ber_tlv(0x04, b"public")].concat();
        message.extend(pdu);
        let response = ber_tlv(0x30, &message);

        assert_eq!(
            parse_snmp_identity_response(&response),
            Some(SnmpIdentity {
                description: "Cisco Catalyst C9300".to_string(),
                object_id: "1.3.6.1.4.1.9.1".to_string(),
                name: "core-sw-01.example.com".to_string(),
            })
        );
    }

    #[test]
    fn device_heuristics_prefer_specific_snmp_and_port_signals() {
        let switch = SnmpIdentity {
            description: "Cisco Catalyst C9300 Software".to_string(),
            ..SnmpIdentity::default()
        };
        assert_eq!(
            infer_device_identity(Some(&switch), &[22, 443, 9100]),
            (
                Some(IpamDeviceType::Switch),
                "Cisco Catalyst C9300 Software".to_string()
            )
        );
        assert_eq!(
            infer_device_identity(None, &[80, 631]),
            (Some(IpamDeviceType::Printer), String::new())
        );
        assert_eq!(infer_device_identity(None, &[22, 443]), (None, String::new()));
    }

    #[test]
    fn hostnames_are_trimmed_and_root_dots_removed() {
        assert_eq!(
            normalize_hostname(" core-sw-01.example.com. "),
            Some("core-sw-01.example.com".to_string())
        );
        assert_eq!(normalize_hostname(" . "), None);
    }

    #[test]
    fn import_resolution_fills_only_blank_hostnames() {
        let input = |address: &str, dns_name: &str| IpamImportAddressInput {
            address: address.to_string(),
            vrf: String::new(),
            status: Default::default(),
            dns_name: dns_name.to_string(),
            device_type: None,
            device_model: String::new(),
            description: String::new(),
            site_id: None,
        };
        let mut addresses = vec![
            input("192.0.2.10", ""),
            input("192.0.2.11", "from-file.example.com"),
            input("192.0.2.12", ""),
        ];
        let names = HashMap::from([
            ("192.0.2.10".to_string(), "from-ptr.example.com".to_string()),
            (
                "192.0.2.11".to_string(),
                "must-not-overwrite.example.com".to_string(),
            ),
        ]);

        apply_resolved_hostnames(&mut addresses, &names);

        assert_eq!(addresses[0].dns_name, "from-ptr.example.com");
        assert_eq!(addresses[1].dns_name, "from-file.example.com");
        assert!(addresses[2].dns_name.is_empty());
    }
}

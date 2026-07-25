//! Explicit, bounded network discovery for selected IPAM Prefixes.
//!
//! A host is considered used when any independent signal answers: ICMP echo,
//! an SNMPv2c sysDescr request using the conventional read-only `public`
//! community, or a TCP full-connect to a small common-management port set.
//! Results are transient and are persisted only when the operator imports them.

use std::{collections::HashSet, sync::Arc, time::Duration};

use futures::{StreamExt, stream};
use rusqlite::{Connection as SqliteConnection, params_from_iter};
use tokio::net::UdpSocket;

use crate::net::{ping, scan};

use super::{
    ipv4::{self, Prefix},
    types::IpamScanResult,
};

pub const MAX_SCAN_ADDRESSES: usize = 4096;
const ADDRESS_CONCURRENCY: usize = 32;
const PROBE_TIMEOUT_MS: u64 = 650;
const COMMON_PORTS: [u16; 10] = [22, 23, 53, 80, 161, 443, 445, 3389, 5985, 5986];

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
    let results = stream::iter(
        targets
            .into_iter()
            .map(|target| async move { probe_target(target).await }),
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

async fn probe_target(target: ScanTarget) -> Option<IpamScanResult> {
    let address = target.address.clone();
    let ping_probe = ping::probe_once(&address, PROBE_TIMEOUT_MS);
    let snmp_probe = probe_snmp(&address, PROBE_TIMEOUT_MS);
    let port_probe = probe_common_ports(&address);
    let (ping_rtt, snmp, open_ports) = tokio::join!(ping_probe, snmp_probe, port_probe);
    if ping_rtt.is_none() && !snmp && open_ports.is_empty() {
        return None;
    }
    Some(IpamScanResult {
        address,
        prefix_id: target.prefix_id,
        cidr: target.cidr,
        vrf: target.vrf,
        site_id: target.site_id,
        ping: ping_rtt.is_some(),
        snmp,
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

async fn probe_snmp(host: &str, timeout_ms: u64) -> bool {
    let Ok(target) = format!("{host}:161").parse::<std::net::SocketAddr>() else {
        return false;
    };
    let Ok(socket) = UdpSocket::bind("0.0.0.0:0").await else {
        return false;
    };
    if socket.connect(target).await.is_err() {
        return false;
    }
    let request = snmp_sysdescr_request(rand::random::<i32>());
    if socket.send(&request).await.is_err() {
        return false;
    }
    let mut response = [0u8; 1500];
    matches!(
        tokio::time::timeout(
            Duration::from_millis(timeout_ms),
            socket.recv(&mut response)
        )
        .await,
        Ok(Ok(size)) if size > 2 && response[0] == 0x30
    )
}

fn snmp_sysdescr_request(request_id: i32) -> Vec<u8> {
    // SNMPv2c GetRequest for 1.3.6.1.2.1.1.1.0 (sysDescr.0), community
    // "public". All lengths are short-form because this fixed packet is tiny.
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
        0x30,
        0x0e,
        0x30,
        0x0c,
        0x06,
        0x08,
        0x2b,
        0x06,
        0x01,
        0x02,
        0x01,
        0x01,
        0x01,
        0x00,
        0x05,
        0x00,
    ];
    let mut message = vec![0x02, 0x01, 0x01, 0x04, 0x06];
    message.extend_from_slice(b"public");
    message.push(0xa0);
    message.push(pdu.len() as u8);
    message.append(&mut pdu);
    let mut packet = vec![0x30, message.len() as u8];
    packet.extend(message);
    packet
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
    fn snmp_request_is_a_v2c_sysdescr_get() {
        let packet = snmp_sysdescr_request(0x01020304);
        assert_eq!(packet[0], 0x30);
        assert!(packet.windows(6).any(|window| window == b"public"));
        assert!(
            packet.windows(10).any(
                |window| window == [0x06, 0x08, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00]
            )
        );
    }
}

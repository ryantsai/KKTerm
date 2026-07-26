//! DNS lookups via hickory-resolver 0.26.
//! Supports A/AAAA/MX/TXT/PTR/NS/CNAME/SOA/SRV.

use crate::net::NetError;
use hickory_resolver::TokioResolver;
use hickory_resolver::proto::rr::{RData, RecordType};
use serde::Serialize;
use std::time::Instant;

const PER_OP_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecord {
    #[serde(rename = "type")]
    pub record_type: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsResult {
    pub records: Vec<DnsRecord>,
    pub resolver_ms: u128,
}

fn parse_record_type(kind: &str) -> Result<RecordType, NetError> {
    Ok(match kind {
        "A" => RecordType::A,
        "AAAA" => RecordType::AAAA,
        "MX" => RecordType::MX,
        "TXT" => RecordType::TXT,
        "PTR" => RecordType::PTR,
        "NS" => RecordType::NS,
        "CNAME" => RecordType::CNAME,
        "SOA" => RecordType::SOA,
        "SRV" => RecordType::SRV,
        _ => {
            return Err(NetError::invalid(format!(
                "unsupported record type: {}",
                kind
            )));
        }
    })
}

pub(crate) fn build_resolver() -> Result<TokioResolver, NetError> {
    let builder = TokioResolver::builder_tokio().map_err(|e| NetError::ResolverError {
        reason: format!("resolver init: {}", e),
    })?;
    builder.build().map_err(|e| NetError::ResolverError {
        reason: format!("resolver build: {}", e),
    })
}

pub async fn lookup(host: &str, record_type: &str) -> Result<DnsResult, NetError> {
    let host = host.trim();
    if host.is_empty() {
        return Err(NetError::invalid("host is required"));
    }
    let kind = record_type.to_uppercase();
    let rt = parse_record_type(&kind)?;

    let resolver = build_resolver()?;
    let start = Instant::now();
    let host_owned = host.to_string();
    let kind_owned = kind.clone();

    let fut = async move {
        let result = resolver
            .lookup(host_owned.as_str(), rt)
            .await
            .map_err(map_err)?;
        let mut out = Vec::new();
        for record in result.answers() {
            let ttl = Some(record.ttl);
            let (value, priority) = format_rdata(&record.data);
            out.push(DnsRecord {
                record_type: kind_owned.clone(),
                value,
                ttl,
                priority,
            });
        }
        Ok::<_, NetError>(out)
    };

    let records = tokio::time::timeout(std::time::Duration::from_millis(PER_OP_TIMEOUT_MS), fut)
        .await
        .map_err(|_| NetError::Timeout)??;
    Ok(DnsResult {
        records,
        resolver_ms: start.elapsed().as_millis(),
    })
}

fn format_rdata(data: &RData) -> (String, Option<u16>) {
    match data {
        RData::A(a) => (a.0.to_string(), None),
        RData::AAAA(a) => (a.0.to_string(), None),
        RData::MX(mx) => {
            // MX::Display is "priority exchange" — keep priority field structured.
            let s = format!("{}", mx);
            let priority = s
                .split_whitespace()
                .next()
                .and_then(|w| w.parse::<u16>().ok());
            let exchange = s.split_whitespace().nth(1).unwrap_or("").to_string();
            (exchange, priority)
        }
        RData::SRV(srv) => {
            let s = format!("{}", srv);
            let priority = s
                .split_whitespace()
                .next()
                .and_then(|w| w.parse::<u16>().ok());
            (s, priority)
        }
        other => (format!("{}", other), None),
    }
}

fn map_err(e: hickory_resolver::net::NetError) -> NetError {
    let msg = e.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("no record")
        || lower.contains("nxdomain")
        || lower.contains("no records found")
    {
        NetError::HostNotFound { reason: msg }
    } else if lower.contains("timeout") || lower.contains("timed out") {
        NetError::Timeout
    } else {
        NetError::ResolverError { reason: msg }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_empty_host() {
        let err = lookup("", "A").await.unwrap_err();
        assert!(matches!(err, NetError::InvalidArgument { .. }));
    }

    #[tokio::test]
    async fn rejects_unsupported_record_type() {
        let err = lookup("example.com", "BOGUS").await.unwrap_err();
        match err {
            NetError::InvalidArgument { reason } => assert!(reason.contains("BOGUS")),
            other => panic!("expected InvalidArgument, got {:?}", other),
        }
    }

    #[tokio::test]
    #[ignore = "requires network"]
    async fn resolves_cloudflare_a_record() {
        let res = lookup("one.one.one.one", "A").await.unwrap();
        assert!(res.records.iter().any(|r| r.value == "1.1.1.1"));
    }
}

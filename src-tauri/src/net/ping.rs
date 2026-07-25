//! ICMP ping with TCP fallback. Platform-gated backend:
//! - Windows x86/x64: winping crate (IcmpSendEcho2 — same API as ping.exe, no
//!   raw sockets, no elevation required). AV mitigation #1.
//! - Windows ARM64: direct IP Helper IcmpSendEcho backend for IPv4, avoiding
//!   winping's x64-only winapi fork.
//! - Unix: surge-ping (raw sockets; users typically have CAP_NET_RAW or root).
//!
//! Both paths fall through to TCP-connect on `fallback_tcp_port` if ICMP returns
//! a permission/EPERM error on the very first packet.

use crate::net::NetError;
use crate::net::scan::tcp_check;
use serde::Serialize;
use std::net::IpAddr;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::interval;
use tokio_util::sync::CancellationToken;

pub const DEFAULT_COUNT: u32 = 4;
pub const MAX_COUNT: u32 = 256;
pub const DEFAULT_INTERVAL_MS: u64 = 1000;
pub const DEFAULT_TIMEOUT_MS: u64 = 4000;
pub const DEFAULT_TTL: u8 = 64;
pub const DEFAULT_SIZE: usize = 32;
pub const DEFAULT_FALLBACK_PORT: u16 = 80;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingReply {
    pub seq: u32,
    pub mode: &'static str, // "icmp" or "tcp"
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<NetError>,
}

#[derive(Debug, Clone)]
pub struct PingOptions {
    pub count: u32,
    pub interval_ms: u64,
    pub timeout_ms: u64,
    pub ttl: u8,
    pub size: usize,
    pub fallback_tcp_port: u16,
}

impl Default for PingOptions {
    fn default() -> Self {
        Self {
            count: DEFAULT_COUNT,
            interval_ms: DEFAULT_INTERVAL_MS,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            ttl: DEFAULT_TTL,
            size: DEFAULT_SIZE,
            fallback_tcp_port: DEFAULT_FALLBACK_PORT,
        }
    }
}

pub fn validate_options(opts: &PingOptions) -> Result<(), NetError> {
    if opts.count == 0 || opts.count > MAX_COUNT {
        return Err(NetError::invalid(format!(
            "count must be 1..={}",
            MAX_COUNT
        )));
    }
    Ok(())
}

async fn resolve_first(host: &str) -> Result<IpAddr, NetError> {
    let mut addrs = tokio::net::lookup_host(format!("{}:0", host))
        .await
        .map_err(|e| NetError::HostNotFound {
            reason: e.to_string(),
        })?;
    addrs
        .next()
        .map(|s| s.ip())
        .ok_or_else(|| NetError::HostNotFound {
            reason: "no addresses".into(),
        })
}

/// One ICMP-only liveness probe for callers that combine several discovery
/// signals themselves. Unlike `run_ping`, this never falls back to TCP because
/// an IPAM scan probes its TCP evidence independently.
pub async fn probe_once(host: &str, timeout_ms: u64) -> Option<u128> {
    let ip = resolve_first(host).await.ok()?;
    let options = PingOptions {
        count: 1,
        interval_ms: 0,
        timeout_ms,
        ..PingOptions::default()
    };
    match backend::ping_one(ip, &options).await {
        IcmpOutcome::Ok { rtt_ms, .. } => Some(rtt_ms),
        IcmpOutcome::Timeout
        | IcmpOutcome::PermissionDenied(_)
        | IcmpOutcome::OtherError(_) => None,
    }
}

/// Outcome of a single ICMP probe attempt before TCP-fallback decision.
enum IcmpOutcome {
    Ok {
        rtt_ms: u128,
        ttl: Option<u8>,
        from_ip: Option<String>,
    },
    Timeout,
    PermissionDenied(String),
    OtherError(String),
}

#[cfg(all(
    target_os = "windows",
    any(target_arch = "x86", target_arch = "x86_64")
))]
mod backend {
    use super::{IcmpOutcome, PingOptions};
    use std::net::IpAddr;
    use winping::{AsyncPinger, Buffer};

    pub async fn ping_one(ip: IpAddr, opts: &PingOptions) -> IcmpOutcome {
        let mut pinger = AsyncPinger::new();
        pinger.set_ttl(opts.ttl);
        pinger.set_timeout(opts.timeout_ms.min(u32::MAX as u64) as u32);
        let buf = Buffer::with_data(vec![0u8; opts.size]);
        let result = pinger.send(ip, buf).await;
        match result.result {
            Ok(rtt) => IcmpOutcome::Ok {
                rtt_ms: rtt as u128,
                ttl: Some(opts.ttl),
                from_ip: Some(ip.to_string()),
            },
            Err(err) => {
                let s = format!("{:?}", err).to_lowercase();
                if s.contains("timeout") || s.contains("timed_out") {
                    IcmpOutcome::Timeout
                } else if s.contains("permission") || s.contains("access") || s.contains("eperm") {
                    IcmpOutcome::PermissionDenied(format!("{:?}", err))
                } else {
                    IcmpOutcome::OtherError(format!("{:?}", err))
                }
            }
        }
    }
}

#[cfg(all(
    target_os = "windows",
    not(any(target_arch = "x86", target_arch = "x86_64"))
))]
mod backend {
    use super::{IcmpOutcome, PingOptions};
    use std::mem::size_of;
    use std::net::IpAddr;
    use tokio::task;
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        ICMP_ECHO_REPLY, IP_OPTION_INFORMATION, IP_REQ_TIMED_OUT, IP_SUCCESS, IcmpCloseHandle,
        IcmpCreateFile, IcmpSendEcho,
    };

    pub async fn ping_one(ip: IpAddr, opts: &PingOptions) -> IcmpOutcome {
        let IpAddr::V4(ipv4) = ip else {
            return IcmpOutcome::PermissionDenied(
                "Windows ARM64 ICMP backend supports IPv4 only; using TCP fallback".to_string(),
            );
        };
        let opts = opts.clone();

        match task::spawn_blocking(move || ping_ipv4(ipv4.octets(), &opts)).await {
            Ok(outcome) => outcome,
            Err(err) => IcmpOutcome::OtherError(format!("ICMP worker failed: {err}")),
        }
    }

    fn ping_ipv4(octets: [u8; 4], opts: &PingOptions) -> IcmpOutcome {
        unsafe {
            let handle = IcmpCreateFile();
            if handle == INVALID_HANDLE_VALUE {
                return IcmpOutcome::OtherError("IcmpCreateFile failed".to_string());
            }

            let mut payload = vec![0u8; opts.size];
            let mut reply = vec![0u8; size_of::<ICMP_ECHO_REPLY>() + payload.len() + 8];
            let request_options = IP_OPTION_INFORMATION {
                Ttl: opts.ttl,
                ..Default::default()
            };
            let destination = u32::from_ne_bytes(octets);
            let sent = IcmpSendEcho(
                handle,
                destination,
                payload.as_mut_ptr().cast(),
                payload.len().min(u16::MAX as usize) as u16,
                &request_options,
                reply.as_mut_ptr().cast(),
                reply.len().min(u32::MAX as usize) as u32,
                opts.timeout_ms.min(u32::MAX as u64) as u32,
            );
            let _ = IcmpCloseHandle(handle);

            if sent == 0 {
                return IcmpOutcome::Timeout;
            }

            let echo = &*(reply.as_ptr() as *const ICMP_ECHO_REPLY);
            match echo.Status {
                IP_SUCCESS => IcmpOutcome::Ok {
                    rtt_ms: echo.RoundTripTime as u128,
                    ttl: Some(echo.Options.Ttl),
                    from_ip: Some(std::net::Ipv4Addr::from(echo.Address.to_ne_bytes()).to_string()),
                },
                IP_REQ_TIMED_OUT => IcmpOutcome::Timeout,
                status => IcmpOutcome::OtherError(format!("IcmpSendEcho status {status}")),
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod backend {
    use super::{IcmpOutcome, PingOptions};
    use std::net::IpAddr;
    use std::time::Duration;
    use surge_ping::{Client, Config, ICMP, IcmpPacket, PingIdentifier, PingSequence};

    pub async fn ping_one(ip: IpAddr, opts: &PingOptions) -> IcmpOutcome {
        let icmp_kind = match ip {
            IpAddr::V4(_) => ICMP::V4,
            IpAddr::V6(_) => ICMP::V6,
        };
        let config = Config::builder().kind(icmp_kind).build();
        let client = match Client::new(&config) {
            Ok(c) => c,
            Err(e) => {
                let s = format!("{:?}", e).to_lowercase();
                if s.contains("permission")
                    || s.contains("operation not permitted")
                    || s.contains("eperm")
                {
                    return IcmpOutcome::PermissionDenied(format!("{:?}", e));
                }
                return IcmpOutcome::OtherError(format!("{:?}", e));
            }
        };
        let mut pinger = client
            .pinger(ip, PingIdentifier(rand::random::<u16>()))
            .await;
        pinger.timeout(Duration::from_millis(opts.timeout_ms));
        let payload = vec![0u8; opts.size];
        match pinger.ping(PingSequence(0), &payload).await {
            Ok((IcmpPacket::V4(p), rtt)) => IcmpOutcome::Ok {
                rtt_ms: rtt.as_millis(),
                ttl: p.get_ttl(),
                from_ip: Some(p.get_source().to_string()),
            },
            Ok((IcmpPacket::V6(p), rtt)) => IcmpOutcome::Ok {
                rtt_ms: rtt.as_millis(),
                ttl: Some(p.get_max_hop_limit()),
                from_ip: Some(p.get_source().to_string()),
            },
            Err(e) => {
                let s = format!("{:?}", e).to_lowercase();
                if s.contains("timeout") {
                    IcmpOutcome::Timeout
                } else if s.contains("permission") || s.contains("eperm") {
                    IcmpOutcome::PermissionDenied(format!("{:?}", e))
                } else {
                    IcmpOutcome::OtherError(format!("{:?}", e))
                }
            }
        }
    }
}

pub async fn run_ping(
    host: &str,
    opts: PingOptions,
    cancel: CancellationToken,
    out: mpsc::UnboundedSender<PingReply>,
) -> Result<(), NetError> {
    validate_options(&opts)?;
    let ip = resolve_first(host).await?;
    let mut tick = interval(Duration::from_millis(opts.interval_ms));
    let mut use_tcp_fallback = false;

    for seq in 0..opts.count {
        if cancel.is_cancelled() {
            return Ok(());
        }
        tick.tick().await;

        if use_tcp_fallback {
            let r = tcp_check(host, opts.fallback_tcp_port, Some(opts.timeout_ms)).await;
            let _ = out.send(PingReply {
                seq,
                mode: "tcp",
                ok: r.open,
                rtt_ms: r.rtt_ms,
                ttl: None,
                from_ip: Some(ip.to_string()),
                error: r.error,
            });
            continue;
        }

        match backend::ping_one(ip, &opts).await {
            IcmpOutcome::Ok {
                rtt_ms,
                ttl,
                from_ip,
            } => {
                let _ = out.send(PingReply {
                    seq,
                    mode: "icmp",
                    ok: true,
                    rtt_ms: Some(rtt_ms),
                    ttl,
                    from_ip,
                    error: None,
                });
            }
            IcmpOutcome::Timeout => {
                let _ = out.send(PingReply {
                    seq,
                    mode: "icmp",
                    ok: false,
                    rtt_ms: None,
                    ttl: None,
                    from_ip: Some(ip.to_string()),
                    error: Some(NetError::Timeout),
                });
            }
            IcmpOutcome::PermissionDenied(hint) if seq == 0 => {
                use_tcp_fallback = true;
                let r = tcp_check(host, opts.fallback_tcp_port, Some(opts.timeout_ms)).await;
                let _ = out.send(PingReply {
                    seq,
                    mode: "tcp",
                    ok: r.open,
                    rtt_ms: r.rtt_ms,
                    ttl: None,
                    from_ip: Some(ip.to_string()),
                    error: if !r.open && r.error.is_none() {
                        Some(NetError::PermissionDenied { hint })
                    } else {
                        r.error
                    },
                });
            }
            IcmpOutcome::PermissionDenied(hint) => {
                let _ = out.send(PingReply {
                    seq,
                    mode: "icmp",
                    ok: false,
                    rtt_ms: None,
                    ttl: None,
                    from_ip: Some(ip.to_string()),
                    error: Some(NetError::PermissionDenied { hint }),
                });
            }
            IcmpOutcome::OtherError(reason) => {
                let _ = out.send(PingReply {
                    seq,
                    mode: "icmp",
                    ok: false,
                    rtt_ms: None,
                    ttl: None,
                    from_ip: Some(ip.to_string()),
                    error: Some(NetError::internal(reason)),
                });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_count_zero_invalid() {
        let mut o = PingOptions::default();
        o.count = 0;
        assert!(validate_options(&o).is_err());
    }

    #[test]
    fn validate_count_over_max_invalid() {
        let mut o = PingOptions::default();
        o.count = MAX_COUNT + 1;
        assert!(validate_options(&o).is_err());
    }

    #[test]
    fn validate_count_max_ok() {
        let mut o = PingOptions::default();
        o.count = MAX_COUNT;
        assert!(validate_options(&o).is_ok());
    }

    #[tokio::test]
    async fn resolve_loopback() {
        let ip = resolve_first("127.0.0.1").await.unwrap();
        assert_eq!(ip.to_string(), "127.0.0.1");
    }

    #[tokio::test]
    async fn resolve_invalid_host_errors() {
        let err = resolve_first("definitely-not-a-real-host-zz.invalid").await;
        assert!(err.is_err());
    }
}

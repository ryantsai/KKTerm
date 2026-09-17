//! Tauri command wrappers for `net::*`. Streaming commands take a `subscriptionId`
//! and emit per-result events over the single global channel `net://event`.
//!
//! Policy gates (allowWidgetNetworkTools, ai.network) are wired in lib.rs at the
//! registration boundary in a follow-up task once storage accessors exist.

use crate::net::{
    NetError, dns, interfaces, ping, profiles, scan, stream::StreamRegistry, whois, wol,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

pub const EVENT_CHANNEL: &str = "net://event";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NetEventPayload {
    subscription_id: String,
    kind: &'static str, // "event" or "done"
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<NetError>,
}

fn emit_event(app: &AppHandle, subscription_id: &str, payload: serde_json::Value) {
    let _ = app.emit(
        EVENT_CHANNEL,
        NetEventPayload {
            subscription_id: subscription_id.into(),
            kind: "event",
            payload: Some(payload),
            ok: None,
            error: None,
        },
    );
}

fn emit_done(app: &AppHandle, subscription_id: &str, ok: bool, error: Option<NetError>) {
    let _ = app.emit(
        EVENT_CHANNEL,
        NetEventPayload {
            subscription_id: subscription_id.into(),
            kind: "done",
            payload: None,
            ok: Some(ok),
            error,
        },
    );
}

// ============ One-shot commands ============

#[tauri::command]
pub async fn network_dns_lookup(
    host: String,
    #[allow(non_snake_case)] recordType: Option<String>,
) -> Result<dns::DnsResult, NetError> {
    dns::lookup(&host, recordType.as_deref().unwrap_or("A")).await
}

#[tauri::command]
pub async fn network_tcp_check(
    host: String,
    port: u16,
    #[allow(non_snake_case)] timeoutMs: Option<u64>,
) -> Result<scan::TcpCheckResult, NetError> {
    Ok(scan::tcp_check(&host, port, timeoutMs).await)
}

#[tauri::command]
pub fn network_interfaces() -> Result<Vec<interfaces::NetInterface>, NetError> {
    interfaces::list_interfaces()
}

#[tauri::command]
pub async fn network_profiles_snapshot() -> Result<profiles::NetworkProfilesSnapshot, String> {
    tauri::async_runtime::spawn_blocking(profiles::snapshot)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn network_profiles_apply(
    request: profiles::ApplyNetworkProfileRequest,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || profiles::apply(request))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn network_wol(
    mac: String,
    broadcast: Option<String>,
    port: Option<u16>,
) -> Result<wol::WolResult, NetError> {
    wol::wake(&mac, broadcast.as_deref(), port).await
}

#[tauri::command]
pub async fn network_whois(domain: String) -> Result<whois::WhoisResult, NetError> {
    whois::lookup(&domain).await
}

// ============ Streaming commands ============

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingStartArgs {
    pub subscription_id: String,
    pub host: String,
    pub count: Option<u32>,
    pub interval_ms: Option<u64>,
    pub timeout_ms: Option<u64>,
    pub ttl: Option<u8>,
    pub size: Option<usize>,
    pub fallback_tcp_port: Option<u16>,
}

#[tauri::command]
pub async fn network_ping_start(
    args: PingStartArgs,
    app: AppHandle,
    registry: State<'_, Arc<StreamRegistry>>,
) -> Result<(), NetError> {
    let token = registry
        .register(args.subscription_id.clone())
        .map_err(|_| NetError::ConcurrencyLimit)?;
    let opts = ping::PingOptions {
        count: args.count.unwrap_or(ping::DEFAULT_COUNT),
        interval_ms: args.interval_ms.unwrap_or(ping::DEFAULT_INTERVAL_MS),
        timeout_ms: args.timeout_ms.unwrap_or(ping::DEFAULT_TIMEOUT_MS),
        ttl: args.ttl.unwrap_or(ping::DEFAULT_TTL),
        size: args.size.unwrap_or(ping::DEFAULT_SIZE),
        fallback_tcp_port: args
            .fallback_tcp_port
            .unwrap_or(ping::DEFAULT_FALLBACK_PORT),
    };
    let reg_arc: Arc<StreamRegistry> = registry.inner().clone();
    let app_clone = app.clone();
    let id = args.subscription_id.clone();
    let host = args.host.clone();
    tokio::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel::<ping::PingReply>();
        let id_for_pump = id.clone();
        let app_for_pump = app_clone.clone();
        let pump = tokio::spawn(async move {
            while let Some(reply) = rx.recv().await {
                emit_event(
                    &app_for_pump,
                    &id_for_pump,
                    serde_json::to_value(reply).unwrap_or_default(),
                );
            }
        });
        let outcome = ping::run_ping(&host, opts, token.clone(), tx).await;
        let _ = pump.await;
        let cancelled = token.is_cancelled();
        match outcome {
            Ok(()) => emit_done(
                &app_clone,
                &id,
                !cancelled,
                if cancelled {
                    Some(NetError::Cancelled)
                } else {
                    None
                },
            ),
            Err(e) => emit_done(&app_clone, &id, false, Some(e)),
        }
        reg_arc.finish(&id);
    });
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortScanStartArgs {
    pub subscription_id: String,
    pub host: String,
    pub ports: Vec<u16>,
    pub concurrency: Option<usize>,
    pub timeout_ms: Option<u64>,
    pub jitter_ms: Option<u64>,
}

#[tauri::command]
pub async fn network_port_scan_start(
    args: PortScanStartArgs,
    app: AppHandle,
    registry: State<'_, Arc<StreamRegistry>>,
) -> Result<(), NetError> {
    let token = registry
        .register(args.subscription_id.clone())
        .map_err(|_| NetError::ConcurrencyLimit)?;
    let opts = scan::PortScanOptions {
        concurrency: args.concurrency.unwrap_or(scan::SCAN_CONCURRENCY),
        timeout_ms: args.timeout_ms.unwrap_or(scan::DEFAULT_CONNECT_TIMEOUT_MS),
        jitter_ms: args.jitter_ms.unwrap_or(scan::SCAN_JITTER_MS),
    };
    let reg_arc: Arc<StreamRegistry> = registry.inner().clone();
    let app_clone = app.clone();
    let id = args.subscription_id.clone();
    let host = args.host.clone();
    let ports = args.ports.clone();
    tokio::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel::<scan::PortResult>();
        let id_for_pump = id.clone();
        let app_for_pump = app_clone.clone();
        let pump = tokio::spawn(async move {
            while let Some(r) = rx.recv().await {
                emit_event(
                    &app_for_pump,
                    &id_for_pump,
                    serde_json::to_value(r).unwrap_or_default(),
                );
            }
        });
        let outcome = scan::run_port_scan(&host, ports, opts, token.clone(), tx).await;
        let _ = pump.await;
        let cancelled = token.is_cancelled();
        match outcome {
            Ok(()) => emit_done(
                &app_clone,
                &id,
                !cancelled,
                if cancelled {
                    Some(NetError::Cancelled)
                } else {
                    None
                },
            ),
            Err(e) => emit_done(&app_clone, &id, false, Some(e)),
        }
        reg_arc.finish(&id);
    });
    Ok(())
}

#[tauri::command]
pub fn network_stream_cancel(
    #[allow(non_snake_case)] subscriptionId: String,
    registry: State<'_, Arc<StreamRegistry>>,
) {
    registry.cancel(&subscriptionId);
}

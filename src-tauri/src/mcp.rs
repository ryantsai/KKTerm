// Remote MCP (Model Context Protocol) HTTP-streamable transport.
//
// Phase 1 scope:
// - HTTP JSON-RPC client (initialize, tools/list, tools/call)
// - Short-lived sessions (reuse Mcp-Session-Id within one validation/tool call)
// - Single auth header per server, stored in OS keychain
// - JSON and SSE response parsing
// - SQLite storage of server config + cached tool schemas
//
// Deferred (future phases): OAuth, cross-call session reuse,
// progress notifications, capability negotiation beyond minimum.

use std::collections::HashMap;

use futures::StreamExt;
use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State};

use crate::dashboard_ids::new_dashboard_id;
use crate::secrets;

const KKTERM_CLIENT_NAME: &str = "kkterm";
const MAX_TOOL_LIST_PAGES: usize = 100;

// -- Public types -----------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub secret_header_name: Option<String>,
    pub secret_value_template: Option<String>,
    pub has_secret: bool,
    pub tools: Option<Value>,
    pub tools_fetched_at: Option<String>,
    pub last_status: String,
    pub last_error: Option<String>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCallResult {
    pub content: Value,
    pub is_error: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum McpCommandError {
    Validation { reason: String },
    NotFound,
    DuplicateName,
    KeychainUnavailable,
    Network { message: String },
    Protocol { message: String },
    AuthError { message: String },
    Internal { message: String },
}

impl From<rusqlite::Error> for McpCommandError {
    fn from(value: rusqlite::Error) -> Self {
        McpCommandError::Internal {
            message: value.to_string(),
        }
    }
}

// -- Owner id ---------------------------------------------------------------

pub fn mcp_secret_owner_id(server_id: &str) -> String {
    format!("mcp-server:{server_id}")
}

// -- Storage ----------------------------------------------------------------

pub fn list_servers(conn: &SqliteConnection) -> Result<Vec<McpServer>, McpCommandError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, url, headers_json, secret_header_name, secret_value_template,
                has_secret, tools_json, tools_fetched_at, last_status, last_error,
                sort_order, created_at, updated_at
         FROM mcp_servers
         ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
    )?;
    let rows = stmt
        .query_map([], row_to_server)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_server_by_id(
    conn: &SqliteConnection,
    id: &str,
) -> Result<Option<McpServer>, McpCommandError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, url, headers_json, secret_header_name, secret_value_template,
                has_secret, tools_json, tools_fetched_at, last_status, last_error,
                sort_order, created_at, updated_at
         FROM mcp_servers
         WHERE id = ?1",
    )?;
    let row = stmt.query_row(params![id], row_to_server).optional()?;
    Ok(row)
}

pub fn get_server_by_name(
    conn: &SqliteConnection,
    name: &str,
) -> Result<Option<McpServer>, McpCommandError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, url, headers_json, secret_header_name, secret_value_template,
                has_secret, tools_json, tools_fetched_at, last_status, last_error,
                sort_order, created_at, updated_at
         FROM mcp_servers
         WHERE name = ?1",
    )?;
    let row = stmt.query_row(params![name], row_to_server).optional()?;
    Ok(row)
}

fn row_to_server(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpServer> {
    let headers_json: String = row.get(3)?;
    let headers =
        serde_json::from_str::<HashMap<String, String>>(&headers_json).unwrap_or_default();
    let tools_json: Option<String> = row.get(7)?;
    let tools = tools_json
        .as_deref()
        .and_then(|s| serde_json::from_str::<Value>(s).ok());
    Ok(McpServer {
        id: row.get(0)?,
        name: row.get(1)?,
        url: row.get(2)?,
        headers,
        secret_header_name: row.get(4)?,
        secret_value_template: row.get(5)?,
        has_secret: row.get::<_, i64>(6)? != 0,
        tools,
        tools_fetched_at: row.get(8)?,
        last_status: row.get(9)?,
        last_error: row.get(10)?,
        sort_order: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

fn insert_server(
    conn: &SqliteConnection,
    server: &McpServer,
) -> Result<McpServer, McpCommandError> {
    let headers_json = serde_json::to_string(&server.headers).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT INTO mcp_servers (
            id, name, url, headers_json, secret_header_name, secret_value_template,
            has_secret, last_status, sort_order
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'unknown', ?8)",
        params![
            server.id,
            server.name,
            server.url,
            headers_json,
            server.secret_header_name,
            server.secret_value_template,
            i64::from(server.has_secret),
            server.sort_order,
        ],
    )
    .map_err(map_unique_violation)?;
    get_server_by_id(conn, &server.id)?.ok_or(McpCommandError::Internal {
        message: "inserted MCP server vanished".to_string(),
    })
}

fn map_unique_violation(error: rusqlite::Error) -> McpCommandError {
    let text = error.to_string();
    if text.contains("UNIQUE constraint failed") {
        McpCommandError::DuplicateName
    } else {
        McpCommandError::Internal { message: text }
    }
}

fn map_keychain_error(_message: String) -> McpCommandError {
    McpCommandError::KeychainUnavailable
}

fn insert_server_with_secret(
    conn: &SqliteConnection,
    server: &McpServer,
    secret: Option<String>,
    mut store_secret: impl FnMut(String, String) -> Result<(), String>,
    mut delete_secret: impl FnMut(String) -> Result<(), String>,
) -> Result<McpServer, McpCommandError> {
    let Some(secret_value) = secret else {
        return insert_server(conn, server);
    };

    let owner_id = mcp_secret_owner_id(&server.id);
    store_secret(owner_id.clone(), secret_value).map_err(map_keychain_error)?;

    match insert_server(conn, server) {
        Ok(stored) => Ok(stored),
        Err(error) => {
            let _ = delete_secret(owner_id);
            Err(error)
        }
    }
}

fn update_status(
    conn: &SqliteConnection,
    id: &str,
    status: &str,
    error: Option<&str>,
    tools_json: Option<&str>,
) -> Result<(), McpCommandError> {
    let now = chrono_now();
    conn.execute(
        "UPDATE mcp_servers
         SET last_status = ?2,
             last_error = ?3,
             tools_json = COALESCE(?4, tools_json),
             tools_fetched_at = CASE WHEN ?4 IS NOT NULL THEN ?5 ELSE tools_fetched_at END,
             updated_at = ?5
         WHERE id = ?1",
        params![id, status, error, tools_json, now],
    )?;
    Ok(())
}

fn delete_server_row(conn: &SqliteConnection, id: &str) -> Result<(), McpCommandError> {
    let affected = conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(McpCommandError::NotFound);
    }
    Ok(())
}

fn chrono_now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".to_string())
}

// -- Validation -------------------------------------------------------------

fn validate_name(value: &str) -> Result<String, McpCommandError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return Err(McpCommandError::Validation {
            reason: "name must be 1-64 characters".to_string(),
        });
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(McpCommandError::Validation {
            reason: "name cannot contain control characters".to_string(),
        });
    }
    Ok(trimmed.to_string())
}

fn validate_url(value: &str, allow_insecure_mcp_http: bool) -> Result<String, McpCommandError> {
    let trimmed = value.trim();
    let parsed = url::Url::parse(trimmed).map_err(|e| McpCommandError::Validation {
        reason: format!("invalid url: {e}"),
    })?;
    match parsed.scheme() {
        "https" => {}
        "http" if allow_insecure_mcp_http || is_loopback_url_host(&parsed) => {}
        "http" => {
            return Err(McpCommandError::Validation {
                reason: "http:// Remote MCP servers are allowed only for localhost unless Settings enables insecure local/network MCP HTTP servers".to_string(),
            });
        }
        _ => {
            return Err(McpCommandError::Validation {
                reason: "url must use http or https scheme".to_string(),
            });
        }
    }
    Ok(parsed.to_string())
}

fn is_loopback_url_host(parsed: &url::Url) -> bool {
    match parsed.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(addr)) => addr.is_loopback(),
        Some(url::Host::Ipv6(addr)) => addr.is_loopback(),
        None => false,
    }
}

fn validate_headers(headers: &HashMap<String, String>) -> Result<(), McpCommandError> {
    if headers.len() > 32 {
        return Err(McpCommandError::Validation {
            reason: "too many headers (limit 32)".to_string(),
        });
    }
    for (name, value) in headers {
        if name.is_empty() || name.len() > 128 {
            return Err(McpCommandError::Validation {
                reason: format!("invalid header name length: {name}"),
            });
        }
        if name.chars().any(|c| c.is_control() || c == ':') {
            return Err(McpCommandError::Validation {
                reason: format!("invalid header name: {name}"),
            });
        }
        if value.len() > 8 * 1024 {
            return Err(McpCommandError::Validation {
                reason: format!("header {name} value too large"),
            });
        }
        if value.chars().any(|c| c == '\n' || c == '\r') {
            return Err(McpCommandError::Validation {
                reason: format!("header {name} value contains newline"),
            });
        }
    }
    Ok(())
}

// -- HTTP client ------------------------------------------------------------

fn build_headers(
    server: &McpServer,
    secret_value: Option<&str>,
    session_id: Option<&str>,
    protocol_version: Option<&str>,
) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let mut headers = HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static("application/json, text/event-stream"),
    );
    for (name, value) in &server.headers {
        if let (Ok(n), Ok(v)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            headers.insert(n, v);
        }
    }
    if let (Some(name), Some(template), Some(secret)) = (
        server.secret_header_name.as_deref(),
        server.secret_value_template.as_deref(),
        secret_value,
    ) {
        let resolved = template.replace("{SECRET}", secret);
        if let (Ok(n), Ok(v)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(&resolved),
        ) {
            headers.insert(n, v);
        }
    }
    if let Some(session_id) = session_id {
        if let Ok(value) = HeaderValue::from_str(session_id) {
            headers.insert("mcp-session-id", value);
        }
    }
    if let Some(protocol_version) = protocol_version {
        if let Ok(value) = HeaderValue::from_str(protocol_version) {
            headers.insert("mcp-protocol-version", value);
        }
    }
    headers
}

struct RpcResponse {
    result: Value,
    session_id: Option<String>,
}

async fn rpc_call(
    http: &reqwest::Client,
    server: &McpServer,
    secret_value: Option<&str>,
    session_id: Option<&str>,
    protocol_version: Option<&str>,
    method: &str,
    params: Value,
    rpc_id: u64,
) -> Result<RpcResponse, McpCommandError> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": rpc_id,
        "method": method,
        "params": params,
    });
    crate::logging::mcp_debug(
        "remote.request",
        &json!({
            "serverId": server.id.clone(),
            "serverName": server.name.clone(),
            "url": server.url.clone(),
            "method": method,
            "rpcId": rpc_id,
            "body": body.clone(),
        }),
    );
    let response = http
        .post(&server.url)
        .headers(build_headers(
            server,
            secret_value,
            session_id,
            protocol_version,
        ))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            crate::logging::mcp_debug(
                "remote.network_error",
                &json!({
                    "serverId": server.id.clone(),
                    "serverName": server.name.clone(),
                    "url": server.url.clone(),
                    "method": method,
                    "rpcId": rpc_id,
                    "message": e.to_string(),
                }),
            );
            McpCommandError::Network {
                message: e.to_string(),
            }
        })?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        crate::logging::mcp_debug(
            "remote.auth_error",
            &json!({
                "serverId": server.id.clone(),
                "serverName": server.name.clone(),
                "url": server.url.clone(),
                "method": method,
                "rpcId": rpc_id,
                "status": status.as_u16(),
            }),
        );
        return Err(McpCommandError::AuthError {
            message: format!("HTTP {status}"),
        });
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let response_session_id = extract_session_id(response.headers());
    if !status.is_success() {
        let body_text = response.text().await.unwrap_or_default();
        crate::logging::mcp_debug(
            "remote.http_error",
            &json!({
                "serverId": server.id.clone(),
                "serverName": server.name.clone(),
                "url": server.url.clone(),
                "method": method,
                "rpcId": rpc_id,
                "status": status.as_u16(),
                "body": body_text.clone(),
            }),
        );
        return Err(McpCommandError::Protocol {
            message: format!("HTTP {status}: {body_text}"),
        });
    }
    if content_type.contains("text/event-stream") {
        let result = read_sse_rpc_result(response, rpc_id, server, method).await?;
        return Ok(RpcResponse {
            result,
            session_id: response_session_id,
        });
    }
    let response_body = response
        .text()
        .await
        .map_err(|e| McpCommandError::Network {
            message: e.to_string(),
        })?;
    crate::logging::mcp_debug(
        "remote.response",
        &json!({
            "serverId": server.id.clone(),
            "serverName": server.name.clone(),
            "url": server.url.clone(),
            "method": method,
            "rpcId": rpc_id,
            "status": status.as_u16(),
            "body": response_body.clone(),
        }),
    );
    let parsed: Value =
        serde_json::from_str(&response_body).map_err(|e| McpCommandError::Protocol {
            message: format!("invalid JSON response: {e}"),
        })?;
    let result = json_rpc_result(parsed, rpc_id)?;
    Ok(RpcResponse {
        result,
        session_id: response_session_id,
    })
}

fn extract_session_id(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.bytes().all(|byte| (0x21..=0x7e).contains(&byte)))
        .map(str::to_string)
}

fn json_rpc_result(parsed: Value, rpc_id: u64) -> Result<Value, McpCommandError> {
    if !rpc_id_matches(&parsed, rpc_id) {
        return Err(McpCommandError::Protocol {
            message: format!("missing JSON-RPC response for id {rpc_id}"),
        });
    }
    if let Some(error) = parsed.get("error") {
        return Err(McpCommandError::Protocol {
            message: format!("JSON-RPC error: {error}"),
        });
    }
    parsed
        .get("result")
        .cloned()
        .ok_or(McpCommandError::Protocol {
            message: "missing result field".to_string(),
        })
}

fn rpc_id_matches(value: &Value, rpc_id: u64) -> bool {
    value
        .get("id")
        .and_then(Value::as_u64)
        .is_some_and(|id| id == rpc_id)
}

async fn read_sse_rpc_result(
    response: reqwest::Response,
    rpc_id: u64,
    server: &McpServer,
    method: &str,
) -> Result<Value, McpCommandError> {
    let mut buffer = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| McpCommandError::Network {
            message: e.to_string(),
        })?;
        let chunk_text = String::from_utf8_lossy(&chunk);
        crate::logging::mcp_debug(
            "remote.sse_chunk",
            &json!({
                "serverId": server.id.clone(),
                "serverName": server.name.clone(),
                "url": server.url.clone(),
                "method": method,
                "rpcId": rpc_id,
                "chunk": chunk_text.as_ref(),
            }),
        );
        buffer.push_str(&chunk_text);
        while let Some((event, rest)) = split_next_sse_event(&buffer) {
            buffer = rest;
            if let Some(result) = parse_sse_rpc_event(&event, rpc_id)? {
                return Ok(result);
            }
        }
    }
    if !buffer.trim().is_empty() {
        if let Some(result) = parse_sse_rpc_event(&buffer, rpc_id)? {
            return Ok(result);
        }
    }
    Err(McpCommandError::Protocol {
        message: format!("SSE stream ended without JSON-RPC response for id {rpc_id}"),
    })
}

#[cfg(test)]
fn parse_sse_rpc_result(body: &str, rpc_id: u64) -> Result<Value, McpCommandError> {
    let mut remaining = body.to_string();
    while let Some((event, rest)) = split_next_sse_event(&remaining) {
        remaining = rest;
        if let Some(result) = parse_sse_rpc_event(&event, rpc_id)? {
            return Ok(result);
        }
    }
    if !remaining.trim().is_empty() {
        if let Some(result) = parse_sse_rpc_event(&remaining, rpc_id)? {
            return Ok(result);
        }
    }
    Err(McpCommandError::Protocol {
        message: format!("SSE stream ended without JSON-RPC response for id {rpc_id}"),
    })
}

fn split_next_sse_event(buffer: &str) -> Option<(String, String)> {
    let candidates = ["\r\n\r\n", "\n\n"];
    let (index, separator) = candidates
        .iter()
        .filter_map(|separator| buffer.find(separator).map(|index| (index, *separator)))
        .min_by_key(|(index, _)| *index)?;
    let event = buffer[..index].to_string();
    let rest = buffer[index + separator.len()..].to_string();
    Some((event, rest))
}

fn parse_sse_rpc_event(event: &str, rpc_id: u64) -> Result<Option<Value>, McpCommandError> {
    let data = sse_event_data(event);
    if data.trim().is_empty() {
        return Ok(None);
    }
    let parsed: Value = serde_json::from_str(&data).map_err(|e| McpCommandError::Protocol {
        message: format!("invalid SSE JSON-RPC event: {e}"),
    })?;
    if rpc_id_matches(&parsed, rpc_id) {
        return json_rpc_result(parsed, rpc_id).map(Some);
    }
    Ok(None)
}

fn sse_event_data(event: &str) -> String {
    let mut lines = Vec::new();
    for line in event.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        lines.push(data.strip_prefix(' ').unwrap_or(data));
    }
    lines.join("\n")
}

async fn initialize(
    http: &reqwest::Client,
    server: &McpServer,
    secret_value: Option<&str>,
) -> Result<(Option<String>, String), McpCommandError> {
    let params = json!({
        "protocolVersion": crate::mcp_protocol::LATEST_PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {
            "name": KKTERM_CLIENT_NAME,
            "version": env!("CARGO_PKG_VERSION"),
        }
    });
    let response = rpc_call(
        http,
        server,
        secret_value,
        None,
        None,
        "initialize",
        params,
        1,
    )
    .await?;
    let protocol_version = response
        .result
        .get("protocolVersion")
        .and_then(Value::as_str)
        .ok_or_else(|| McpCommandError::Protocol {
            message: "initialize response is missing protocolVersion".to_string(),
        })?
        .to_string();
    if !crate::mcp_protocol::SUPPORTED_PROTOCOL_VERSIONS.contains(&protocol_version.as_str()) {
        return Err(McpCommandError::Protocol {
            message: format!("server selected unsupported MCP protocol version {protocol_version}"),
        });
    }
    let session_id = response.session_id;
    // Send initialized notification (id-less per JSON-RPC notification)
    let initialized_response = http
        .post(&server.url)
        .headers(build_headers(
            server,
            secret_value,
            session_id.as_deref(),
            Some(&protocol_version),
        ))
        .json(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
        }))
        .send()
        .await
        .map_err(|error| McpCommandError::Network {
            message: error.to_string(),
        })?;
    if !initialized_response.status().is_success() {
        return Err(McpCommandError::Protocol {
            message: format!(
                "initialized notification failed with HTTP {}",
                initialized_response.status()
            ),
        });
    }
    Ok((session_id, protocol_version))
}

async fn fetch_tools(
    http: &reqwest::Client,
    server: &McpServer,
    secret_value: Option<&str>,
) -> Result<Value, McpCommandError> {
    let (session_id, protocol_version) = initialize(http, server, secret_value).await?;
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    for page_index in 0..MAX_TOOL_LIST_PAGES {
        let params = cursor
            .as_ref()
            .map_or_else(|| json!({}), |cursor| json!({ "cursor": cursor }));
        let result = rpc_call(
            http,
            server,
            secret_value,
            session_id.as_deref(),
            Some(&protocol_version),
            "tools/list",
            params,
            2 + page_index as u64,
        )
        .await?
        .result;
        cursor = append_tool_list_page(&result, &mut tools)?;
        if cursor.is_none() {
            return Ok(json!({ "tools": tools }));
        }
    }
    Err(McpCommandError::Protocol {
        message: format!("tools/list exceeded {MAX_TOOL_LIST_PAGES} pages"),
    })
}

fn append_tool_list_page(
    result: &Value,
    tools: &mut Vec<Value>,
) -> Result<Option<String>, McpCommandError> {
    let page_tools = result
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| McpCommandError::Protocol {
            message: "tools/list result is missing tools array".to_string(),
        })?;
    tools.extend(page_tools.iter().cloned());
    Ok(result
        .get("nextCursor")
        .and_then(Value::as_str)
        .filter(|cursor| !cursor.is_empty())
        .map(str::to_string))
}

async fn call_tool(
    http: &reqwest::Client,
    server: &McpServer,
    secret_value: Option<&str>,
    tool_name: &str,
    arguments: Value,
) -> Result<Value, McpCommandError> {
    let (session_id, protocol_version) = initialize(http, server, secret_value).await?;
    let params = json!({
        "name": tool_name,
        "arguments": arguments,
    });
    rpc_call(
        http,
        server,
        secret_value,
        session_id.as_deref(),
        Some(&protocol_version),
        "tools/call",
        params,
        3,
    )
    .await
    .map(|response| response.result)
}

fn http_client() -> Result<reqwest::Client, McpCommandError> {
    crate::net::proxy::apply_async(reqwest::Client::builder())
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| McpCommandError::Internal {
            message: e.to_string(),
        })
}

pub(crate) async fn call_ephemeral_http_tool(
    url: &str,
    server_name: &str,
    secret_header_name: Option<&str>,
    secret_value: Option<&str>,
    tool_name: &str,
    arguments: Value,
    allow_insecure_tls: bool,
) -> Result<McpCallResult, McpCommandError> {
    let server = McpServer {
        id: server_name.to_ascii_lowercase(),
        name: server_name.to_string(),
        url: url.to_string(),
        headers: HashMap::new(),
        secret_header_name: secret_header_name.map(str::to_string),
        secret_value_template: secret_header_name.map(|_| "{SECRET}".to_string()),
        has_secret: secret_value.is_some(),
        tools: None,
        tools_fetched_at: None,
        last_status: String::new(),
        last_error: None,
        sort_order: 0,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let http = crate::net::proxy::apply_async(reqwest::Client::builder())
        .danger_accept_invalid_certs(allow_insecure_tls)
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| McpCommandError::Internal {
            message: error.to_string(),
        })?;
    let result = call_tool(
        &http,
        &server,
        secret_value,
        tool_name,
        arguments,
    )
    .await?;
    let is_error = result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let content = result.get("content").cloned().unwrap_or(Value::Null);
    Ok(McpCallResult { content, is_error })
}

// -- Tauri commands ---------------------------------------------------------

fn storage(app: &AppHandle) -> State<'_, crate::storage::Storage> {
    app.state::<crate::storage::Storage>()
}

fn remote_mcp_allows_insecure_http(app: &AppHandle) -> Result<bool, McpCommandError> {
    storage(app)
        .ai_provider_settings()
        .map(|settings| settings.allow_insecure_mcp_http())
        .map_err(|message| McpCommandError::Internal { message })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMcpServerRequest {
    pub name: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub secret_header_name: Option<String>,
    pub secret_value_template: Option<String>,
    pub secret: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMcpServerRequest {
    pub id: String,
    pub name: Option<String>,
    pub url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub secret_header_name: Option<Option<String>>,
    pub secret_value_template: Option<Option<String>>,
    pub secret: Option<Option<String>>,
}

#[tauri::command]
pub fn mcp_list_servers(app: AppHandle) -> Result<Vec<McpServer>, McpCommandError> {
    storage(&app).with_connection_infallible(|conn| list_servers(conn))
}

#[tauri::command]
pub async fn mcp_create_server(
    app: AppHandle,
    secrets: State<'_, secrets::Secrets>,
    request: CreateMcpServerRequest,
) -> Result<McpServer, McpCommandError> {
    let name = validate_name(&request.name)?;
    let allow_insecure_mcp_http = remote_mcp_allows_insecure_http(&app)?;
    let url = validate_url(&request.url, allow_insecure_mcp_http)?;
    let headers = request.headers.unwrap_or_default();
    validate_headers(&headers)?;
    if request.secret_header_name.is_some() != request.secret_value_template.is_some() {
        return Err(McpCommandError::Validation {
            reason: "secret header name and value template must both be present or both absent"
                .to_string(),
        });
    }
    let header_name = request
        .secret_header_name
        .as_deref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let value_template = request
        .secret_value_template
        .as_deref()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());
    if header_name.is_some() != value_template.is_some() {
        return Err(McpCommandError::Validation {
            reason: "secret header configuration is incomplete".to_string(),
        });
    }
    if let Some(template) = value_template.as_deref() {
        if !template.contains("{SECRET}") {
            return Err(McpCommandError::Validation {
                reason: "secret_value_template must contain the literal {SECRET} placeholder"
                    .to_string(),
            });
        }
    }
    let secret = request.secret.filter(|s| !s.is_empty());
    let has_secret = secret.is_some();
    if has_secret && header_name.is_none() {
        return Err(McpCommandError::Validation {
            reason: "secret value provided without a header name".to_string(),
        });
    }
    let id = new_dashboard_id("mcp");
    let sort_order = storage(&app).with_connection_infallible(|conn| next_sort_order(conn))?;
    let server = McpServer {
        id: id.clone(),
        name,
        url,
        headers,
        secret_header_name: header_name,
        secret_value_template: value_template,
        has_secret,
        tools: None,
        tools_fetched_at: None,
        last_status: "unknown".to_string(),
        last_error: None,
        sort_order,
        created_at: chrono_now(),
        updated_at: chrono_now(),
    };
    crate::storage::run_blocking_db(|| {
        storage(&app).with_connection_infallible(|conn| {
            insert_server_with_secret(
                conn,
                &server,
                secret,
                |owner_id, value| secrets.store_mcp_server_secret(owner_id, value),
                |owner_id| secrets.delete_mcp_server_secret(owner_id),
            )
        })
    })
}

fn next_sort_order(conn: &SqliteConnection) -> Result<i64, McpCommandError> {
    let next: Option<i64> = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM mcp_servers",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(next.unwrap_or(0))
}

#[tauri::command]
pub async fn mcp_update_server(
    app: AppHandle,
    secrets: State<'_, secrets::Secrets>,
    request: UpdateMcpServerRequest,
) -> Result<McpServer, McpCommandError> {
    let id = request.id.clone();
    let existing = storage(&app)
        .with_connection_infallible(|conn| get_server_by_id(conn, &id))?
        .ok_or(McpCommandError::NotFound)?;
    let allow_insecure_mcp_http = remote_mcp_allows_insecure_http(&app)?;
    let new_name = match request.name {
        Some(value) => validate_name(&value)?,
        None => existing.name.clone(),
    };
    let new_url = match request.url {
        Some(value) => validate_url(&value, allow_insecure_mcp_http)?,
        None => existing.url.clone(),
    };
    let new_headers = match request.headers {
        Some(value) => {
            validate_headers(&value)?;
            value
        }
        None => existing.headers.clone(),
    };
    let new_secret_header_name = match request.secret_header_name {
        Some(value) => value
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        None => existing.secret_header_name.clone(),
    };
    let new_value_template = match request.secret_value_template {
        Some(value) => value.filter(|s| !s.is_empty()),
        None => existing.secret_value_template.clone(),
    };
    if new_secret_header_name.is_some() != new_value_template.is_some() {
        return Err(McpCommandError::Validation {
            reason: "secret header configuration is incomplete".to_string(),
        });
    }
    if let Some(template) = new_value_template.as_deref() {
        if !template.contains("{SECRET}") {
            return Err(McpCommandError::Validation {
                reason: "secret_value_template must contain {SECRET}".to_string(),
            });
        }
    }
    let mut has_secret = existing.has_secret;
    if let Some(secret_change) = request.secret {
        match secret_change {
            Some(value) if !value.is_empty() => {
                secrets
                    .store_mcp_server_secret(mcp_secret_owner_id(&id), value)
                    .map_err(map_keychain_error)?;
                has_secret = true;
            }
            _ => {
                secrets
                    .delete_mcp_server_secret(mcp_secret_owner_id(&id))
                    .map_err(map_keychain_error)?;
                has_secret = false;
            }
        }
    }
    if !has_secret {
        // Don't keep a stale header config that requires a secret we don't have.
        // We still allow auth-less changes by clearing template fields if no secret remains.
    }
    let headers_json = serde_json::to_string(&new_headers).unwrap_or_else(|_| "{}".to_string());
    crate::storage::run_blocking_db(|| {
        storage(&app).with_connection_infallible(|conn| -> Result<(), McpCommandError> {
            conn.execute(
                "UPDATE mcp_servers
                 SET name = ?2, url = ?3, headers_json = ?4, secret_header_name = ?5,
                     secret_value_template = ?6, has_secret = ?7, updated_at = ?8
                 WHERE id = ?1",
                params![
                    id,
                    new_name,
                    new_url,
                    headers_json,
                    new_secret_header_name,
                    new_value_template,
                    i64::from(has_secret),
                    chrono_now(),
                ],
            )
            .map_err(map_unique_violation)?;
            Ok(())
        })
    })?;
    storage(&app)
        .with_connection_infallible(|conn| get_server_by_id(conn, &id))?
        .ok_or(McpCommandError::NotFound)
}

#[tauri::command]
pub async fn mcp_delete_server(
    app: AppHandle,
    secrets: State<'_, secrets::Secrets>,
    id: String,
) -> Result<(), McpCommandError> {
    let _ = secrets.delete_mcp_server_secret(mcp_secret_owner_id(&id));
    storage(&app).with_connection_infallible(|conn| delete_server_row(conn, &id))
}

#[tauri::command]
pub async fn mcp_refresh_tools(
    app: AppHandle,
    secrets: State<'_, secrets::Secrets>,
    id: String,
) -> Result<McpServer, McpCommandError> {
    let server = storage(&app)
        .with_connection_infallible(|conn| get_server_by_id(conn, &id))?
        .ok_or(McpCommandError::NotFound)?;
    validate_url(&server.url, remote_mcp_allows_insecure_http(&app)?)?;
    let secret = if server.has_secret {
        secrets
            .read_mcp_server_secret(mcp_secret_owner_id(&server.id))
            .map_err(map_keychain_error)?
    } else {
        None
    };
    let http = http_client()?;
    let outcome = fetch_tools(&http, &server, secret.as_deref()).await;
    let app_clone = app.clone();
    let id_clone = server.id.clone();
    crate::storage::run_blocking_db(|| -> Result<(), McpCommandError> {
        match &outcome {
            Ok(tools) => {
                let tools_json = serde_json::to_string(tools).unwrap_or_else(|_| "{}".to_string());
                storage(&app_clone).with_connection_infallible(|conn| {
                    update_status(conn, &id_clone, "ok", None, Some(&tools_json))
                })?;
            }
            Err(err) => {
                let (status, message) = status_for_error(err);
                storage(&app_clone).with_connection_infallible(|conn| {
                    update_status(conn, &id_clone, status, Some(message.as_str()), None)
                })?;
            }
        }
        Ok(())
    })?;
    outcome?;
    storage(&app)
        .with_connection_infallible(|conn| get_server_by_id(conn, &id))?
        .ok_or(McpCommandError::NotFound)
}

#[tauri::command]
pub async fn mcp_call_tool(
    app: AppHandle,
    secrets: State<'_, secrets::Secrets>,
    server_id_or_name: String,
    tool_name: String,
    arguments: Value,
) -> Result<McpCallResult, McpCommandError> {
    let server = storage(&app).with_connection_infallible(|conn| {
        if let Some(by_id) = get_server_by_id(conn, &server_id_or_name)? {
            Ok::<_, McpCommandError>(Some(by_id))
        } else {
            get_server_by_name(conn, &server_id_or_name)
        }
    })?;
    let server = server.ok_or(McpCommandError::NotFound)?;
    validate_url(&server.url, remote_mcp_allows_insecure_http(&app)?)?;
    let secret = if server.has_secret {
        secrets
            .read_mcp_server_secret(mcp_secret_owner_id(&server.id))
            .map_err(map_keychain_error)?
    } else {
        None
    };
    let http = http_client()?;
    let outcome = call_tool(&http, &server, secret.as_deref(), &tool_name, arguments).await;
    let app_clone = app.clone();
    let id_clone = server.id.clone();
    crate::storage::run_blocking_db(|| match &outcome {
        Ok(_) => {
            let _ = storage(&app_clone).with_connection_infallible(|conn| {
                update_status(conn, &id_clone, "ok", None, None)
            });
        }
        Err(err) => {
            let (status, message) = status_for_error(err);
            let _ = storage(&app_clone).with_connection_infallible(|conn| {
                update_status(conn, &id_clone, status, Some(message.as_str()), None)
            });
        }
    });
    let result_value = outcome?;
    let is_error = result_value
        .get("isError")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let content = result_value.get("content").cloned().unwrap_or(Value::Null);
    Ok(McpCallResult { content, is_error })
}

fn status_for_error(err: &McpCommandError) -> (&'static str, String) {
    match err {
        McpCommandError::Network { message } => ("unreachable", message.clone()),
        McpCommandError::AuthError { message } => ("auth_error", message.clone()),
        McpCommandError::Protocol { message } => ("protocol_error", message.clone()),
        other => ("protocol_error", format!("{other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn test_connection() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().expect("in-memory database opens");
        conn.execute_batch(
            "CREATE TABLE mcp_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                url TEXT NOT NULL,
                headers_json TEXT NOT NULL DEFAULT '{}',
                secret_header_name TEXT,
                secret_value_template TEXT,
                has_secret INTEGER NOT NULL DEFAULT 0,
                tools_json TEXT,
                tools_fetched_at TEXT,
                last_status TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (last_status IN ('ok', 'unreachable', 'auth_error', 'protocol_error', 'unknown')),
                last_error TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .expect("schema initializes");
        conn
    }

    fn sample_server(id: &str, name: &str) -> McpServer {
        McpServer {
            id: id.to_string(),
            name: name.to_string(),
            url: "https://example.com/mcp".to_string(),
            headers: HashMap::new(),
            secret_header_name: Some("Authorization".to_string()),
            secret_value_template: Some("Bearer {SECRET}".to_string()),
            has_secret: true,
            tools: None,
            tools_fetched_at: None,
            last_status: "unknown".to_string(),
            last_error: None,
            sort_order: 0,
            created_at: chrono_now(),
            updated_at: chrono_now(),
        }
    }

    #[test]
    fn session_id_is_extracted_from_response_headers() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "mcp-session-id",
            reqwest::header::HeaderValue::from_static("session-abc123"),
        );

        assert_eq!(
            extract_session_id(&headers),
            Some("session-abc123".to_string())
        );
    }

    #[test]
    fn session_id_is_sent_on_follow_up_requests() {
        let server = sample_server("mcp_test", "Example MCP");

        let headers = build_headers(
            &server,
            Some("secret-token"),
            Some("session-abc123"),
            Some(crate::mcp_protocol::LATEST_PROTOCOL_VERSION),
        );

        assert_eq!(
            headers
                .get("mcp-session-id")
                .and_then(|value| value.to_str().ok()),
            Some("session-abc123")
        );
        assert_eq!(
            headers
                .get("authorization")
                .and_then(|value| value.to_str().ok()),
            Some("Bearer secret-token")
        );
        assert_eq!(
            headers
                .get("mcp-protocol-version")
                .and_then(|value| value.to_str().ok()),
            Some(crate::mcp_protocol::LATEST_PROTOCOL_VERSION)
        );
    }

    #[test]
    fn paginated_tool_lists_are_combined_without_caching_cursors() {
        let mut tools = Vec::new();

        let cursor = append_tool_list_page(
            &json!({ "tools": [{ "name": "first" }], "nextCursor": "page-2" }),
            &mut tools,
        )
        .expect("first page parses");
        assert_eq!(cursor.as_deref(), Some("page-2"));
        let cursor = append_tool_list_page(&json!({ "tools": [{ "name": "second" }] }), &mut tools)
            .expect("final page parses");

        assert_eq!(cursor, None);
        assert_eq!(
            tools,
            vec![json!({ "name": "first" }), json!({ "name": "second" })]
        );
    }

    #[test]
    fn tool_list_page_requires_a_tools_array() {
        let error = append_tool_list_page(&json!({ "nextCursor": "page-2" }), &mut Vec::new())
            .expect_err("malformed page is rejected");

        assert!(
            matches!(error, McpCommandError::Protocol { message } if message.contains("missing tools array"))
        );
    }

    #[test]
    fn validate_url_allows_https_and_loopback_http_by_default() {
        assert!(validate_url("https://example.com/mcp", false).is_ok());
        assert!(validate_url("http://localhost:8000/mcp", false).is_ok());
        assert!(validate_url("http://127.0.0.1:8000/mcp", false).is_ok());
        assert!(validate_url("http://[::1]:8000/mcp", false).is_ok());
    }

    #[test]
    fn validate_url_rejects_external_http_without_insecure_setting() {
        let error = validate_url("http://192.168.1.10:8000/mcp", false)
            .expect_err("network HTTP is blocked by default");

        assert!(
            matches!(error, McpCommandError::Validation { reason } if reason.contains("insecure local/network MCP HTTP"))
        );
    }

    #[test]
    fn validate_url_allows_network_http_with_insecure_setting() {
        assert!(validate_url("http://192.168.1.10:8000/mcp", true).is_ok());
    }

    #[test]
    fn create_with_secret_does_not_insert_row_when_keychain_store_fails() {
        let conn = test_connection();
        let server = sample_server("mcp_test", "Example MCP");

        let error = insert_server_with_secret(
            &conn,
            &server,
            Some("token".to_string()),
            |_owner_id, _value| Err("keychain unavailable".to_string()),
            |_owner_id| Ok(()),
        )
        .expect_err("keychain failure aborts create");

        assert!(matches!(error, McpCommandError::KeychainUnavailable));
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM mcp_servers", [], |row| row.get(0))
            .expect("count query succeeds");
        assert_eq!(count, 0);
    }

    #[test]
    fn create_with_secret_deletes_stored_secret_when_insert_fails() {
        let conn = test_connection();
        let existing = sample_server("mcp_existing", "Example MCP");
        insert_server_with_secret(
            &conn,
            &existing,
            None,
            |_owner_id, _value| Ok(()),
            |_owner_id| Ok(()),
        )
        .expect("existing server inserts");

        let duplicate = sample_server("mcp_duplicate", "Example MCP");
        let stored_owner_ids = RefCell::new(Vec::new());
        let deleted_owner_ids = RefCell::new(Vec::new());
        let error = insert_server_with_secret(
            &conn,
            &duplicate,
            Some("token".to_string()),
            |owner_id, _value| {
                stored_owner_ids.borrow_mut().push(owner_id);
                Ok(())
            },
            |owner_id| {
                deleted_owner_ids.borrow_mut().push(owner_id);
                Ok(())
            },
        )
        .expect_err("duplicate name rejects create");

        assert!(matches!(error, McpCommandError::DuplicateName));
        let owner_id = mcp_secret_owner_id("mcp_duplicate");
        assert_eq!(stored_owner_ids.into_inner(), vec![owner_id.clone()]);
        assert_eq!(deleted_owner_ids.into_inner(), vec![owner_id]);
    }

    #[test]
    fn sse_rpc_response_ignores_notifications_until_matching_result() {
        let body = concat!(
            ": keep-alive\n\n",
            "event: message\n",
            "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{\"progress\":1}}\n\n",
            "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"echo\"}]}}\n\n",
        );

        let result = parse_sse_rpc_result(body, 2).expect("matching SSE result parses");

        assert_eq!(result, json!({ "tools": [{ "name": "echo" }] }));
    }

    #[test]
    fn sse_rpc_response_returns_matching_json_rpc_error() {
        let body = concat!(
            "data: {\"jsonrpc\":\"2.0\",\"id\":3,\"error\":{\"code\":-32601,\"message\":\"missing tool\"}}\n\n",
        );

        let error = parse_sse_rpc_result(body, 3).expect_err("JSON-RPC error is surfaced");

        assert!(
            matches!(error, McpCommandError::Protocol { message } if message.contains("missing tool"))
        );
    }

    #[test]
    fn sse_rpc_response_requires_matching_result_before_end_of_stream() {
        let body = "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n\n";

        let error = parse_sse_rpc_result(body, 1).expect_err("missing response is rejected");

        assert!(
            matches!(error, McpCommandError::Protocol { message } if message.contains("ended without JSON-RPC response"))
        );
    }
}

// Built-in MCP server bridge.
//
// kkterm.exe hosts a Windows named pipe; the sibling `kkterm-cli` binary
// (launched as a stdio child by external MCP clients like Claude Desktop /
// Codex) forwards JSON-RPC messages across the pipe and back. This module
// owns the server side of the pipe and dispatches MCP `tools/call` requests
// into the same in-process AI tool functions the assistant uses, so MCP
// clients drive real sessions instead of an empty stub.
//
// The frontend handles "live" session work (terminal buffer reads, RDP
// pointer clicks) via the existing AssistantLiveToolBridge round-trip, so
// the bridge stays a thin transport layer.

use std::path::{Path, PathBuf};
use std::sync::Arc;

#[cfg(target_os = "windows")]
use std::process::Command;

use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

#[cfg(any(windows, unix))]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixListener;
#[cfg(target_os = "windows")]
use tokio::net::windows::named_pipe::ServerOptions;

const PROTOCOL_VERSION: &str = "2025-03-26";
const SERVER_NAME: &str = "kkterm-cli";
const BRIDGE_INFO_FILENAME: &str = "mcp-bridge.json";
/// Unix domain socket filename, written next to the descriptor file. On macOS
/// and Linux the bridge listens on this socket instead of a Windows named pipe;
/// its path is published in the descriptor's `pipeName` field.
#[cfg(unix)]
const BRIDGE_SOCKET_FILENAME: &str = "mcp-bridge.sock";
const BRIDGE_INFO_VERSION: u32 = 1;
const MAX_REQUEST_BYTES: usize = 1 * 1024 * 1024;

/// Information written to disk so `kkterm-cli` can locate the live pipe.
/// File lives at `<app_data_dir>/mcp-bridge.json` and is rewritten on each
/// app start. Stale files are detected by the client failing to connect.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub version: u32,
    pub pipe_name: String,
    pub token: String,
    pub pid: u32,
}

/// Filesystem location of the bridge descriptor file.
pub fn bridge_info_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(BRIDGE_INFO_FILENAME)
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn write_bridge_info(path: &Path, info: &BridgeInfo) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let body = serde_json::to_vec_pretty(info).unwrap_or_else(|_| b"{}".to_vec());
    std::fs::write(path, body)?;
    let permission_result = restrict_bridge_info_permissions(path);
    if let Err(error) = permission_result {
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

fn restrict_bridge_info_permissions(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(target_os = "windows")]
    restrict_file_to_current_user(path)?;
    Ok(())
}

/// Tighten the DACL on the bridge-info file so only the current Windows user
/// can read or write it. The descriptor is written before the bridge starts,
/// so failing here prevents publishing a readable bearer token.
#[cfg(target_os = "windows")]
fn restrict_file_to_current_user(path: &Path) -> std::io::Result<()> {
    let sid = current_windows_user_sid()?;
    let grant_arg = format!("*{sid}:(F)");
    let output = no_window(Command::new("icacls").arg(path).args([
        "/inheritance:r",
        "/grant:r",
        &grant_arg,
    ]))
    .output()?;
    if output.status.success() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!(
                "icacls failed while restricting MCP bridge descriptor: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ))
    }
}

#[cfg(target_os = "windows")]
fn current_windows_user_sid() -> std::io::Result<String> {
    let output = no_window(Command::new("whoami").args(["/user", "/fo", "csv", "/nh"])).output()?;
    if !output.status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!(
                "whoami failed while resolving current user SID: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        ));
    }
    let line = String::from_utf8_lossy(&output.stdout);
    parse_windows_user_sid_output(&line).map(str::to_string)
}

#[cfg(any(target_os = "windows", test))]
fn parse_windows_user_sid_output(output: &str) -> std::io::Result<&str> {
    output
        .trim()
        .rsplit(',')
        .next()
        .map(|value| value.trim().trim_matches('"'))
        .filter(|value| value.starts_with("S-1-"))
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "whoami did not return a usable current user SID",
            )
        })
}

fn remove_bridge_info(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Launch the bridge if enabled. Safe to call once per app startup. The
/// `allow_all_dangerous` flag captures the persisted setting; live toggles
/// take effect on next app restart, matching the documented behaviour.
pub fn start_if_enabled(
    app: AppHandle,
    app_data_dir: PathBuf,
    enabled: bool,
    allow_all_dangerous: bool,
) {
    let info_path = bridge_info_path(&app_data_dir);
    // Always clear stale info so external clients see "not running" until we
    // succeed in opening a new pipe.
    remove_bridge_info(&info_path);

    if !enabled {
        crate::logging::mcp_debug("bridge.disabled", &json!({}));
        return;
    }

    #[cfg(target_os = "windows")]
    {
        if let Err(error) = std::thread::Builder::new()
            .name("kkterm-mcp-bridge-startup".to_string())
            .spawn(move || {
                start_windows_bridge(app, info_path, allow_all_dangerous);
            })
        {
            crate::logging::mcp_debug(
                "bridge.startup_thread_failed",
                &json!({"error": error.to_string()}),
            );
            eprintln!("kkterm built-in MCP server: failed to spawn startup thread: {error}");
        }
    }

    // macOS and Linux host the bridge over a Unix domain socket in the same
    // app-data directory, secured with 0600 permissions and the same bearer
    // token as the Windows named pipe.
    #[cfg(unix)]
    {
        let socket_path = app_data_dir.join(BRIDGE_SOCKET_FILENAME);
        tauri::async_runtime::spawn(async move {
            start_unix_bridge(app, info_path, socket_path, allow_all_dangerous).await;
        });
    }

    #[cfg(not(any(windows, unix)))]
    {
        let _ = (app, allow_all_dangerous);
        crate::logging::mcp_debug("bridge.unsupported_platform", &json!({}));
        eprintln!(
            "kkterm built-in MCP server: transport is unsupported on this platform; bridge disabled."
        );
    }
}

#[cfg(target_os = "windows")]
fn start_windows_bridge(app: AppHandle, info_path: PathBuf, allow_all_dangerous: bool) {
    let token = random_token();
    let pipe_name = format!(r"\\.\pipe\kkterm-mcp-{}", &token[..16]);
    let pid = std::process::id();
    let info = BridgeInfo {
        version: BRIDGE_INFO_VERSION,
        pipe_name: pipe_name.clone(),
        token: token.clone(),
        pid,
    };
    if let Err(error) = write_bridge_info(&info_path, &info) {
        crate::logging::mcp_debug(
            "bridge.info_write_failed",
            &json!({"error": error.to_string()}),
        );
        eprintln!("kkterm built-in MCP server: failed to write bridge info: {error}");
        return;
    }
    crate::logging::mcp_debug(
        "bridge.started",
        &json!({
            "pipeName": pipe_name.clone(),
            "pid": pid,
            "allowAllDangerous": allow_all_dangerous,
            "bridgeInfoPath": info_path,
        }),
    );

    let ctx = Arc::new(BridgeContext {
        app,
        token,
        allow_all_dangerous,
    });
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_named_pipe_server(ctx, pipe_name).await {
            crate::logging::mcp_debug(
                "bridge.server_stopped",
                &json!({"error": error.to_string()}),
            );
            eprintln!("kkterm built-in MCP server stopped: {error}");
        }
    });
}

#[cfg(unix)]
async fn start_unix_bridge(
    app: AppHandle,
    info_path: PathBuf,
    socket_path: PathBuf,
    allow_all_dangerous: bool,
) {
    // A stale socket file (e.g. from a previous run that did not clean up)
    // would make `bind` fail with EADDRINUSE, so remove it first.
    let _ = std::fs::remove_file(&socket_path);
    let listener = match UnixListener::bind(&socket_path) {
        Ok(listener) => listener,
        Err(error) => {
            crate::logging::mcp_debug(
                "bridge.bind_failed",
                &json!({"error": error.to_string(), "socketPath": socket_path}),
            );
            eprintln!("kkterm built-in MCP server: failed to bind unix socket: {error}");
            return;
        }
    };
    if let Err(error) = restrict_unix_socket_permissions(&socket_path) {
        crate::logging::mcp_debug(
            "bridge.socket_permission_failed",
            &json!({"error": error.to_string()}),
        );
        eprintln!("kkterm built-in MCP server: failed to secure unix socket: {error}");
        let _ = std::fs::remove_file(&socket_path);
        return;
    }

    let token = random_token();
    let pid = std::process::id();
    let info = BridgeInfo {
        version: BRIDGE_INFO_VERSION,
        pipe_name: socket_path.to_string_lossy().into_owned(),
        token: token.clone(),
        pid,
    };
    // The descriptor is written only after the socket is bound and secured, so
    // a client that successfully reads it can always connect (no
    // publish-before-listen race).
    if let Err(error) = write_bridge_info(&info_path, &info) {
        crate::logging::mcp_debug(
            "bridge.info_write_failed",
            &json!({"error": error.to_string()}),
        );
        eprintln!("kkterm built-in MCP server: failed to write bridge info: {error}");
        let _ = std::fs::remove_file(&socket_path);
        return;
    }
    crate::logging::mcp_debug(
        "bridge.started",
        &json!({
            "socketPath": socket_path,
            "pid": pid,
            "allowAllDangerous": allow_all_dangerous,
            "bridgeInfoPath": info_path,
        }),
    );

    let ctx = Arc::new(BridgeContext {
        app,
        token,
        allow_all_dangerous,
    });
    if let Err(error) = run_unix_socket_server(ctx, listener).await {
        crate::logging::mcp_debug(
            "bridge.server_stopped",
            &json!({"error": error.to_string()}),
        );
        eprintln!("kkterm built-in MCP server stopped: {error}");
    }
}

/// Tighten the socket file so only the current user can connect. Combined with
/// the bearer token in the (also 0600) descriptor, this keeps other local users
/// off the bridge.
#[cfg(unix)]
fn restrict_unix_socket_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(unix)]
async fn run_unix_socket_server(
    ctx: Arc<BridgeContext>,
    listener: UnixListener,
) -> std::io::Result<()> {
    loop {
        let (stream, _addr) = listener.accept().await?;
        let ctx = Arc::clone(&ctx);
        tauri::async_runtime::spawn(async move {
            if let Err(error) = serve_client(ctx, stream).await {
                crate::logging::mcp_debug(
                    "bridge.client_ended",
                    &json!({"error": error.to_string()}),
                );
                eprintln!("kkterm MCP bridge client ended: {error}");
            }
        });
    }
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
fn no_window(command: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
    command
}

struct BridgeContext {
    app: AppHandle,
    token: String,
    allow_all_dangerous: bool,
}

#[cfg(target_os = "windows")]
async fn run_named_pipe_server(ctx: Arc<BridgeContext>, pipe_name: String) -> std::io::Result<()> {
    // The first server instance is created with first_pipe_instance(true) so
    // we own the name on this user's session and reject impostors.
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&pipe_name)?;
    loop {
        server.connect().await?;
        let connection = server;
        server = ServerOptions::new().create(&pipe_name)?;
        let ctx = Arc::clone(&ctx);
        tauri::async_runtime::spawn(async move {
            if let Err(error) = serve_client(ctx, connection).await {
                crate::logging::mcp_debug(
                    "bridge.client_ended",
                    &json!({"error": error.to_string()}),
                );
                eprintln!("kkterm MCP bridge client ended: {error}");
            }
        });
    }
}

#[cfg(any(windows, unix))]
async fn serve_client<S>(ctx: Arc<BridgeContext>, stream: S) -> std::io::Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (reader, mut writer) = tokio::io::split(stream);
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    // First framed line is the bearer token sent by kkterm-cli. Reject
    // anything else.
    let bytes = reader.read_line(&mut line).await?;
    if bytes == 0 {
        return Ok(());
    }
    if line.trim() != ctx.token {
        crate::logging::mcp_debug("bridge.client_auth_failed", &json!({}));
        let _ = writer
            .write_all(
                b"{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32001,\"message\":\"unauthorized\"}}\n",
            )
            .await;
        return Ok(());
    }
    crate::logging::mcp_debug("bridge.client_auth_ok", &json!({}));
    let _ = writer.write_all(b"{\"ok\":true}\n").await;
    let _ = writer.flush().await;

    line.clear();
    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).await?;
        if bytes == 0 {
            return Ok(());
        }
        if bytes > MAX_REQUEST_BYTES {
            return Ok(());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                crate::logging::mcp_debug(
                    "bridge.request_parse_error",
                    &json!({"error": error.to_string(), "raw": trimmed}),
                );
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": {"code": -32700, "message": format!("parse error: {error}")},
                });
                write_response(&mut writer, &response).await?;
                continue;
            }
        };
        crate::logging::mcp_debug("bridge.request", &redact_bridge_request(&request));
        let response = handle_request(&ctx, request).await;
        if let Some(response) = response {
            crate::logging::mcp_debug("bridge.response", &redact_bridge_response(&response));
            write_response(&mut writer, &response).await?;
        }
    }
}

#[cfg(any(windows, unix))]
async fn write_response<W: tokio::io::AsyncWriteExt + Unpin>(
    writer: &mut W,
    response: &Value,
) -> std::io::Result<()> {
    let mut bytes = serde_json::to_vec(response).unwrap_or_else(|_| b"{}".to_vec());
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    writer.flush().await
}

async fn handle_request(ctx: &BridgeContext, request: Value) -> Option<Value> {
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let params = request.get("params").cloned().unwrap_or(Value::Null);

    match method.as_str() {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "serverInfo": {
                    "name": SERVER_NAME,
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "capabilities": {"tools": {}},
            },
        })),
        "notifications/initialized" => None,
        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {"tools": crate::mcp_tool_catalog::tool_descriptors()},
        })),
        "tools/call" => Some(handle_tool_call(ctx, id, params).await),
        "ping" => Some(json!({"jsonrpc": "2.0", "id": id, "result": {}})),
        other => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": -32601, "message": format!("method not found: {other}")},
        })),
    }
}

fn dangerous_tool(name: &str) -> bool {
    // Any segment named `dangerous` in the dotted MCP tool name flags the
    // tool as gated by `built_in_mcp_allow_all_dangerous`. This lets safe
    // sub-namespaces (e.g. `kkterm.dashboard.*`) sit alongside dangerous
    // ones (`kkterm.dashboard.dangerous.*`) under a common parent.
    name.split('.').any(|segment| segment == "dangerous")
}

async fn handle_tool_call(ctx: &BridgeContext, id: Value, params: Value) -> Value {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
    crate::logging::mcp_debug(
        "bridge.tool_call",
        &json!({"name": name.clone(), "arguments": redact_tool_arguments(&name, &arguments)}),
    );

    if dangerous_tool(&name) && !ctx.allow_all_dangerous {
        crate::logging::mcp_debug(
            "bridge.tool_blocked",
            &json!({"name": name.clone(), "reason": "dangerous_tools_disabled"}),
        );
        return tool_error_response(
            id,
            "permissionRequired",
            "Dangerous tools require Built-in MCP \"Allow all\" setting to be enabled.",
        );
    }

    let outcome = dispatch_tool(&ctx.app, &name, arguments).await;
    match outcome {
        Ok(value) => {
            crate::logging::mcp_debug(
                "bridge.tool_result",
                &json!({"name": name.clone(), "result": redact_tool_result(&name, &value)}),
            );
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{"type": "text", "text": value_to_text(&value)}],
                    "structuredContent": value,
                    "isError": false,
                },
            })
        }
        Err(message) => {
            crate::logging::mcp_debug(
                "bridge.tool_error",
                &json!({"name": name.clone(), "message": message.clone()}),
            );
            tool_error_response(id, "toolError", &message)
        }
    }
}

fn tool_error_response(id: Value, code: &str, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{"type": "text", "text": message}],
            "structuredContent": {"ok": false, "error": code, "message": message},
            "isError": true,
        },
    })
}

fn value_to_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn redact_bridge_request(request: &Value) -> Value {
    if request.get("method").and_then(Value::as_str) != Some("tools/call") {
        return request.clone();
    }
    let mut redacted = request.clone();
    if let Some(params) = redacted.get_mut("params").and_then(Value::as_object_mut) {
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if let Some(arguments) = params.get_mut("arguments") {
            *arguments = redact_tool_arguments(&name, arguments);
        }
    }
    redacted
}

fn redact_bridge_response(response: &Value) -> Value {
    let mut redacted = response.clone();
    let Some(result) = redacted.get_mut("result").and_then(Value::as_object_mut) else {
        return redacted;
    };
    if result.contains_key("structuredContent") {
        // The response envelope does not carry the tool name, so it cannot
        // apply tool-specific redaction safely. `bridge.tool_result` already
        // logs the useful, name-aware redacted copy.
        result.insert(
            "structuredContent".to_string(),
            Value::String("[REDACTED: see bridge.tool_result]".to_string()),
        );
        if result.contains_key("content") {
            result.insert(
                "content".to_string(),
                json!([{"type": "text", "text": "[REDACTED: see bridge.tool_result]"}]),
            );
        }
    }
    redacted
}

fn redact_tool_arguments(name: &str, arguments: &Value) -> Value {
    let mut redacted = redact_sensitive_debug_value(arguments);
    match name {
        "kkterm.workspace.sessions.dangerous.send_input"
        | "kkterm.workspace.dangerous.remote_desktop_send_text" => {
            redact_object_key(&mut redacted, "text");
        }
        "kkterm.dashboard.dangerous.create_widget" => {
            if let Some(body) = redacted.get_mut("body") {
                redact_object_key(body, "source");
            }
            redact_object_key(&mut redacted, "bodyJson");
        }
        "kkterm.dashboard.dangerous.create_custom_widget" => {
            redact_object_key(&mut redacted, "bodyJson");
        }
        "kkterm.dashboard.dangerous.update_custom_widget" => {
            if let Some(patch) = redacted.get_mut("patch") {
                redact_object_key(patch, "bodyJson");
                if let Some(body) = patch.get_mut("body") {
                    redact_object_key(body, "source");
                }
            }
        }
        // Task/script bodies may embed sensitive material (docs/ITOPS.md).
        "kkterm.itops.tasks.dangerous.create" | "kkterm.itops.tasks.dangerous.update" => {
            redact_object_key(&mut redacted, "task");
        }
        "kkterm.itops.runs.dangerous.start" => {
            redact_object_key(&mut redacted, "script");
        }
        // runBatch actions embed full task bodies.
        "kkterm.itops.automations.dangerous.create"
        | "kkterm.itops.automations.dangerous.update" => {
            redact_object_key(&mut redacted, "actions");
        }
        _ => {}
    }
    redacted
}

fn redact_tool_result(name: &str, result: &Value) -> Value {
    match name {
        "kkterm.workspace.sessions.read_buffer"
        | "kkterm.dashboard.read_widget_source"
        | "kkterm.app.dangerous.capture_window"
        // Task reads and mutation responses contain the full script/playbook.
        | "kkterm.itops.tasks.get"
        | "kkterm.itops.tasks.dangerous.create"
        | "kkterm.itops.tasks.dangerous.update"
        // Automation responses contain runBatch task bodies in their actions.
        | "kkterm.itops.automations.list"
        | "kkterm.itops.automations.dangerous.create"
        | "kkterm.itops.automations.dangerous.update"
        | "kkterm.itops.automations.dangerous.set_enabled"
        // Run reports replay captured remote command output.
        | "kkterm.itops.runs.get_report" => Value::String("[REDACTED]".to_string()),
        _ => redact_sensitive_debug_value(result),
    }
}

fn redact_sensitive_debug_value(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, nested)| {
                    let value = if debug_json_key_is_sensitive(key) {
                        Value::String("[REDACTED]".to_string())
                    } else {
                        redact_sensitive_debug_value(nested)
                    };
                    (key.clone(), value)
                })
                .collect(),
        ),
        Value::Array(items) => {
            Value::Array(items.iter().map(redact_sensitive_debug_value).collect())
        }
        other => other.clone(),
    }
}

fn debug_json_key_is_sensitive(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', ' '], "_");
    normalized == "body_json"
        || normalized == "bodyjson"
        || normalized == "token"
        || normalized.ends_with("_token")
        || normalized.contains("access_token")
        || normalized.contains("accesstoken")
        || normalized.contains("refresh_token")
        || normalized.contains("refreshtoken")
        || normalized.contains("api_key")
        || normalized.contains("apikey")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("authorization")
        || normalized == "data_url"
        || normalized == "dataurl"
        || normalized.ends_with("dataurl")
        || normalized == "thumbnail_data_url"
}

fn redact_object_key(value: &mut Value, key: &str) {
    if let Some(object) = value.as_object_mut() {
        if object.contains_key(key) {
            object.insert(key.to_string(), Value::String("[REDACTED]".to_string()));
        }
    }
}

fn required_tool_string(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{key} is required"))
}

fn remap_required_id(mut args: Value, source: &str, target: &str) -> Result<Value, String> {
    let id = args
        .get(source)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{source} is required"))?
        .to_string();
    let object = args
        .as_object_mut()
        .ok_or_else(|| "arguments must be an object".to_string())?;
    object.remove(source);
    object.insert(target.to_string(), json!(id));
    Ok(args)
}

async fn dispatch_tool(app: &AppHandle, name: &str, args: Value) -> Result<Value, String> {
    match name {
        "kkterm.workspace.workspaces.list" => {
            parse_tool_json(&crate::ai::workspace_tool(app, "workspace_list", json!({})))
        }
        "kkterm.workspace.workspaces.create" => {
            parse_tool_json(&crate::ai::workspace_tool(app, "workspace_create", args))
        }
        "kkterm.workspace.workspaces.rename" => {
            parse_tool_json(&crate::ai::workspace_tool(app, "workspace_rename", args))
        }
        "kkterm.workspace.workspaces.reorder" => {
            parse_tool_json(&crate::ai::workspace_tool(app, "workspace_reorder", args))
        }
        "kkterm.workspace.workspaces.dangerous.delete" => {
            parse_tool_json(&crate::ai::workspace_tool(app, "workspace_delete", args))
        }
        "kkterm.workspace.connections.list" => {
            let raw = crate::ai::connection_tool(app, "connection_list", json!({}));
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connections.create" => {
            let raw = crate::ai::connection_tool(app, "connection_create", args);
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connections.update" => {
            let raw = crate::ai::connection_tool(
                app,
                "connection_update",
                remap_required_id(args, "connectionId", "id")?,
            );
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connections.rename" => {
            let raw = crate::ai::connection_tool(
                app,
                "connection_rename",
                remap_required_id(args, "connectionId", "id")?,
            );
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connections.delete" => {
            let raw = crate::ai::connection_tool(
                app,
                "connection_delete",
                remap_required_id(args, "connectionId", "id")?,
            );
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connections.move" => {
            let raw = crate::ai::connection_tool(
                app,
                "connection_move",
                remap_required_id(args, "connectionId", "id")?,
            );
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connection_folders.create" => {
            let raw = crate::ai::connection_tool(app, "connection_folder_create", args);
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connection_folders.rename" => {
            let raw = crate::ai::connection_tool(
                app,
                "connection_folder_rename",
                remap_required_id(args, "folderId", "id")?,
            );
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connection_folders.delete" => {
            let raw = crate::ai::connection_tool(
                app,
                "connection_folder_delete",
                remap_required_id(args, "folderId", "id")?,
            );
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connection_folders.move" => {
            let raw = crate::ai::connection_tool(
                app,
                "connection_folder_move",
                remap_required_id(args, "folderId", "id")?,
            );
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connections.open" => {
            let connection_id = args
                .get("connectionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "connectionId is required".to_string())?;
            let raw =
                crate::ai::connection_tool(app, "connection_open", json!({"id": connection_id}));
            parse_tool_json(&raw)
        }
        "kkterm.workspace.connections.screenshot" => {
            let connection_id = args
                .get("connectionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "connectionId is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "workspace_connection_screenshot",
                json!({"connectionId": connection_id}),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.sessions.list" => {
            let raw = crate::ai::live_session_tool(app, "session_state", json!({})).await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.sessions.dangerous.send_input" => {
            let pane_id = args
                .get("paneId")
                .and_then(Value::as_str)
                .ok_or_else(|| "paneId is required".to_string())?;
            let text = args
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| "text is required".to_string())?;
            let submit = args.get("submit").and_then(Value::as_bool).unwrap_or(false);
            let raw = crate::ai::live_session_tool(
                app,
                "session_terminal_send_text",
                terminal_send_input_live_tool_args(pane_id, text, submit),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.sessions.read_buffer" => {
            let pane_id = args
                .get("paneId")
                .and_then(Value::as_str)
                .ok_or_else(|| "paneId is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "session_terminal_read_buffer",
                json!({"paneId": pane_id}),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.quick_commands.list" => {
            let connection_id = args
                .get("connectionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "connectionId is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "quick_command_list",
                json!({"connectionId": connection_id}),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.quick_commands.read" => {
            let connection_id = args
                .get("connectionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "connectionId is required".to_string())?;
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "quick_command_read",
                json!({"connectionId": connection_id, "id": id}),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.quick_commands.dangerous.create" => {
            let connection_id = args
                .get("connectionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "connectionId is required".to_string())?;
            let label = args
                .get("label")
                .and_then(Value::as_str)
                .ok_or_else(|| "label is required".to_string())?;
            let command = args
                .get("command")
                .and_then(Value::as_str)
                .ok_or_else(|| "command is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "quick_command_create",
                json!({
                    "connectionId": connection_id,
                    "label": label,
                    "command": command,
                    "iconName": args.get("iconName").and_then(Value::as_str),
                    "accentName": args.get("accentName").and_then(Value::as_str),
                    "sendEnter": args.get("sendEnter").and_then(Value::as_bool),
                    "confirm": args.get("confirm").and_then(Value::as_bool),
                }),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.quick_commands.dangerous.edit" => {
            let connection_id = args
                .get("connectionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "connectionId is required".to_string())?;
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "quick_command_edit",
                json!({
                    "connectionId": connection_id,
                    "id": id,
                    "label": args.get("label").and_then(Value::as_str),
                    "command": args.get("command").and_then(Value::as_str),
                    "iconName": args.get("iconName").and_then(Value::as_str),
                    "accentName": args.get("accentName").and_then(Value::as_str),
                    "sendEnter": args.get("sendEnter").and_then(Value::as_bool),
                    "confirm": args.get("confirm").and_then(Value::as_bool),
                }),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.dangerous.pointer_click" => {
            let pane_id = args
                .get("paneId")
                .and_then(Value::as_str)
                .ok_or_else(|| "paneId is required".to_string())?;
            let x = args
                .get("x")
                .and_then(Value::as_i64)
                .ok_or_else(|| "x is required".to_string())?;
            let y = args
                .get("y")
                .and_then(Value::as_i64)
                .ok_or_else(|| "y is required".to_string())?;
            let button = args.get("button").and_then(Value::as_str).unwrap_or("left");
            let raw = crate::ai::live_session_tool(
                app,
                "session_remote_desktop_mouse_click",
                json!({"paneId": pane_id, "x": x, "y": y, "button": button}),
            )
            .await;
            parse_tool_json(&raw)
        }
        // -- Dashboard: views, instances, layout ---------------------------
        "kkterm.dashboard.load_state" => {
            let raw = crate::ai::dashboard_tool(app, "dashboard_load_state", json!({}));
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.screenshot_view" => {
            let raw = crate::ai::live_session_tool(
                app,
                "dashboard_view_screenshot",
                json!({"viewId": args.get("viewId").and_then(Value::as_str)}),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.dashboard.screenshot_widget" => {
            let instance_id = args
                .get("instanceId")
                .and_then(Value::as_str)
                .ok_or_else(|| "instanceId is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "dashboard_widget_screenshot",
                json!({"instanceId": instance_id}),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.dashboard.read_widget_source" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            let raw =
                crate::ai::dashboard_tool(app, "dashboard_read_widget_source", json!({"id": id}));
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.check_widget_health" => {
            let raw = crate::ai::dashboard_check_widget_health_tool(app, args).await;
            parse_tool_json(&raw)
        }
        "kkterm.dashboard.create_view" => {
            let title = args
                .get("title")
                .and_then(Value::as_str)
                .ok_or_else(|| "title is required".to_string())?;
            let mut forward = json!({"title": title});
            if let Some(density) = args.get("gridDensity").and_then(Value::as_str) {
                forward["gridDensity"] = Value::String(density.to_string());
            }
            let raw = crate::ai::dashboard_tool(app, "dashboard_create_view", forward);
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.update_view" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            let patch = args.get("patch").cloned().unwrap_or(json!({}));
            let raw = crate::ai::dashboard_tool(
                app,
                "dashboard_update_view",
                json!({"id": id, "patch": patch}),
            );
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.remove_view" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            let raw = crate::ai::dashboard_tool(app, "dashboard_remove_view", json!({"id": id}));
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.reorder_views" => {
            let ordered = args.get("orderedIds").cloned().unwrap_or(json!([]));
            let raw = crate::ai::dashboard_tool(
                app,
                "dashboard_reorder_views",
                json!({"orderedIds": ordered}),
            );
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.add_instance" => {
            // Pass through every recognised placement field. The AI tool
            // auto-places missing grid coordinates, but kind, sourceId,
            // preset, accentName, and iconName must be valid (empty values
            // are rejected by storage validation) — the catalog marks them
            // required to match.
            let raw = crate::ai::dashboard_tool(app, "dashboard_add_instance", args);
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.update_instance" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            let patch = args.get("patch").cloned().unwrap_or(json!({}));
            let raw = crate::ai::dashboard_tool(
                app,
                "dashboard_update_instance",
                json!({"id": id, "patch": patch}),
            );
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.remove_instance" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            let raw =
                crate::ai::dashboard_tool(app, "dashboard_remove_instance", json!({"id": id}));
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.apply_layout" => {
            let view_id = args
                .get("viewId")
                .and_then(Value::as_str)
                .ok_or_else(|| "viewId is required".to_string())?;
            let layout = args.get("layout").cloned().unwrap_or(json!([]));
            let raw = crate::ai::dashboard_tool(
                app,
                "dashboard_apply_layout",
                json!({"viewId": view_id, "layout": layout}),
            );
            parse_dashboard_json(&raw)
        }
        // -- Dashboard: AI-Created Widget management (dangerous) -----------
        "kkterm.dashboard.dangerous.create_widget" => {
            let raw = crate::ai::dashboard_tool(app, "dashboard_create_widget", args);
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.dangerous.create_custom_widget" => {
            let raw = crate::ai::dashboard_tool(app, "dashboard_create_custom_widget", args);
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.dangerous.update_custom_widget" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            let patch = args.get("patch").cloned().unwrap_or(json!({}));
            let raw = crate::ai::dashboard_tool(
                app,
                "dashboard_update_custom_widget",
                json!({"id": id, "patch": patch}),
            );
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.dangerous.remove_custom_widget" => {
            let raw = crate::ai::dashboard_tool(app, "dashboard_remove_custom_widget", args);
            parse_dashboard_json(&raw)
        }
        "kkterm.dashboard.dangerous.reset" => {
            let raw = crate::ai::dashboard_tool(app, "dashboard_reset", json!({}));
            parse_dashboard_json(&raw)
        }
        "kkterm.screenshots.list" => {
            let request = serde_json::from_value(args).map_err(|error| error.to_string())?;
            serde_json::to_value(crate::list_screenshots(app.clone(), request).await?)
                .map_err(|error| error.to_string())
        }
        "kkterm.screenshots.dangerous.read" => {
            let id = required_tool_string(&args, "id")?;
            serde_json::to_value(crate::read_screenshot(app.clone(), id).await?)
                .map_err(|error| error.to_string())
        }
        "kkterm.screenshots.rename" => {
            let id = required_tool_string(&args, "id")?;
            let new_name = required_tool_string(&args, "newName")?;
            serde_json::to_value(crate::rename_screenshot(app.clone(), id, new_name).await?)
                .map_err(|error| error.to_string())
        }
        "kkterm.screenshots.copy_to_clipboard" => {
            let id = required_tool_string(&args, "id")?;
            crate::copy_stored_screenshot_to_clipboard(app.clone(), id).await?;
            Ok(json!({"ok": true}))
        }
        "kkterm.screenshots.resize" => {
            let request = serde_json::from_value(args).map_err(|error| error.to_string())?;
            serde_json::to_value(crate::resize_screenshots(app.clone(), request).await?)
                .map_err(|error| error.to_string())
        }
        "kkterm.screenshots.convert" => {
            let request = serde_json::from_value(args).map_err(|error| error.to_string())?;
            serde_json::to_value(crate::convert_screenshots(app.clone(), request).await?)
                .map_err(|error| error.to_string())
        }
        "kkterm.screenshots.dangerous.save_edited" => {
            let request = serde_json::from_value(args).map_err(|error| error.to_string())?;
            serde_json::to_value(crate::save_edited_screenshot(app.clone(), request).await?)
                .map_err(|error| error.to_string())
        }
        "kkterm.screenshots.dangerous.delete" => {
            let id = required_tool_string(&args, "id")?;
            crate::delete_screenshot(app.clone(), id).await?;
            Ok(json!({"ok": true}))
        }
        "kkterm.screenshots.dangerous.delete_batch" => {
            let ids = args
                .get("ids")
                .cloned()
                .ok_or_else(|| "ids is required".to_string())?;
            let ids = serde_json::from_value(ids).map_err(|error| error.to_string())?;
            crate::delete_screenshots(app.clone(), ids).await?;
            Ok(json!({"ok": true}))
        }
        "kkterm.screenshots.dangerous.clear" => {
            crate::clear_screenshots(app.clone()).await?;
            Ok(json!({"ok": true}))
        }
        "kkterm.screenshots.open_folder" => {
            crate::open_screenshots_folder(app.clone(), app.state())?;
            Ok(json!({"ok": true}))
        }
        "kkterm.screenshots.reveal" => {
            let id = required_tool_string(&args, "id")?;
            crate::reveal_screenshot(app.clone(), app.state(), id)?;
            Ok(json!({"ok": true}))
        }
        "kkterm.screenshots.open_file" => {
            let id = required_tool_string(&args, "id")?;
            crate::open_screenshot_file(app.clone(), app.state(), id)?;
            Ok(json!({"ok": true}))
        }
        "kkterm.screenshots.dangerous.capture_rect" => {
            let request = serde_json::from_value(args).map_err(|error| error.to_string())?;
            let result = crate::capture_screenshot_to_library(
                app.clone(),
                request,
                "screenshot".to_string(),
            )
            .await?;
            serde_json::to_value(result).map_err(|error| error.to_string())
        }
        "kkterm.screenshots.dangerous.capture_region"
        | "kkterm.screenshots.dangerous.capture_window"
        | "kkterm.screenshots.dangerous.capture_fullscreen" => {
            let minimize_window = args
                .get("minimizeWindow")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let result = match name {
                "kkterm.screenshots.dangerous.capture_region" => {
                    crate::capture_interactive_region_screenshot_to_library(
                        app.clone(),
                        "region".to_string(),
                        minimize_window,
                    )
                    .await?
                }
                "kkterm.screenshots.dangerous.capture_window" => {
                    crate::capture_active_window_screenshot_to_library(
                        app.clone(),
                        "window".to_string(),
                        minimize_window,
                    )
                    .await?
                }
                _ => {
                    crate::capture_fullscreen_screenshot_to_library(
                        app.clone(),
                        "fullscreen".to_string(),
                        minimize_window,
                    )
                    .await?
                }
            };
            serde_json::to_value(result).map_err(|error| error.to_string())
        }
        // -- IT Ops: Site topology + Rack Devices ---------------------------
        // itops_tool reads the same camelCase argument keys the catalog
        // publishes, validates required fields itself, and reports failures
        // as {"ok": false, "error": …}, so forward arguments unchanged.
        "kkterm.itops.sites.list" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_list_sites", json!({})).await)
        }
        "kkterm.itops.sites.create" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_create_site", args).await)
        }
        "kkterm.itops.sites.update" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_update_site", args).await)
        }
        "kkterm.itops.sites.remove" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_remove_site", args).await)
        }
        "kkterm.itops.sites.reorder" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_reorder_sites", args).await)
        }
        "kkterm.itops.sites.resolve" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_resolve_site", args).await)
        }
        "kkterm.itops.sites.set_background" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_set_site_background", args).await)
        }
        "kkterm.itops.server_rooms.list" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_list_server_rooms", args).await)
        }
        "kkterm.itops.server_rooms.create" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_create_server_room", args).await)
        }
        "kkterm.itops.server_rooms.update" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_update_server_room", args).await)
        }
        "kkterm.itops.server_rooms.remove" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_delete_server_room", args).await)
        }
        "kkterm.itops.server_rooms.duplicate" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_duplicate_server_room", args).await)
        }
        "kkterm.itops.server_rooms.set_background" => parse_tool_json(
            &crate::ai::itops_tool(app, "itops_set_server_room_background", args).await,
        ),
        "kkterm.itops.server_rooms.set_icon" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_set_room_icon", args).await)
        }
        "kkterm.itops.racks.list" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_list_racks", args).await)
        }
        "kkterm.itops.racks.create" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_create_rack", args).await)
        }
        "kkterm.itops.racks.update" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_update_rack", args).await)
        }
        "kkterm.itops.racks.remove" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_delete_rack", args).await)
        }
        "kkterm.itops.racks.duplicate" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_duplicate_rack", args).await)
        }
        "kkterm.itops.racks.reorder" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_reorder_racks", args).await)
        }
        "kkterm.itops.racks.set_placements" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_set_rack_placements", args).await)
        }
        "kkterm.itops.racks.set_facings" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_set_rack_facings", args).await)
        }
        "kkterm.itops.racks.set_background" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_set_rack_background", args).await)
        }
        "kkterm.itops.rack_items.place" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_place_rack_item", args).await)
        }
        "kkterm.itops.rack_items.update" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_update_rack_item", args).await)
        }
        "kkterm.itops.rack_items.move" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_move_rack_item", args).await)
        }
        "kkterm.itops.rack_items.remove" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_remove_rack_item", args).await)
        }
        "kkterm.itops.rack_items.refresh_snmp" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_refresh_rack_item_snmp", args).await)
        }
        "kkterm.itops.room_objects.list" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_list_room_objects", args).await)
        }
        "kkterm.itops.room_objects.set" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_set_room_objects", args).await)
        }
        "kkterm.itops.connections.get" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_get_connection", args).await)
        }
        "kkterm.itops.hosts.list" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_list_hosts", args).await)
        }
        "kkterm.itops.hosts.create" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_create_host", args).await)
        }
        "kkterm.itops.hosts.update" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_update_host", args).await)
        }
        "kkterm.itops.hosts.remove" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_delete_host", args).await)
        }
        "kkterm.itops.hosts.import" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_import_hosts", args).await)
        }
        "kkterm.itops.hosts.scan" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_scan_hosts", args).await)
        }
        "kkterm.itops.tasks.list" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_list_tasks", json!({})).await)
        }
        "kkterm.itops.tasks.get" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_get_task", args).await)
        }
        "kkterm.itops.tasks.dangerous.create" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_create_task", args).await)
        }
        "kkterm.itops.tasks.dangerous.update" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_update_task", args).await)
        }
        "kkterm.itops.tasks.remove" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_remove_task", args).await)
        }
        "kkterm.itops.automations.list" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_list_automations", json!({})).await)
        }
        "kkterm.itops.automations.dangerous.create" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_create_automation", args).await)
        }
        "kkterm.itops.automations.dangerous.update" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_update_automation", args).await)
        }
        "kkterm.itops.automations.dangerous.set_enabled" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_set_automation_enabled", args).await)
        }
        "kkterm.itops.automations.remove" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_remove_automation", args).await)
        }
        "kkterm.itops.automations.test" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_test_automation", args).await)
        }
        "kkterm.itops.runs.dangerous.start" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_start_batch_run", args).await)
        }
        "kkterm.itops.runs.cancel" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_cancel_batch_run", args).await)
        }
        "kkterm.itops.runs.list" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_list_run_history", args).await)
        }
        "kkterm.itops.runs.get_report" => {
            parse_tool_json(&crate::ai::itops_tool(app, "itops_get_run_report", args).await)
        }
        // -- Workspace: SFTP/FTP file browser ------------------------------
        "kkterm.workspace.file_browser.list" => {
            let raw = crate::ai::live_session_tool(
                app,
                "session_file_browser_list",
                json!({
                    "tabId": args.get("tabId").and_then(Value::as_str),
                    "path": args.get("path").and_then(Value::as_str),
                }),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.file_browser.dangerous.create_folder" => {
            let parent_path = args
                .get("parentPath")
                .and_then(Value::as_str)
                .ok_or_else(|| "parentPath is required".to_string())?;
            let folder_name = args
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| "name is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "session_file_browser_create_folder",
                json!({
                    "tabId": args.get("tabId").and_then(Value::as_str),
                    "parentPath": parent_path,
                    "name": folder_name,
                }),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.file_browser.dangerous.rename" => {
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "path is required".to_string())?;
            let new_name = args
                .get("newName")
                .and_then(Value::as_str)
                .ok_or_else(|| "newName is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "session_file_browser_rename",
                json!({
                    "tabId": args.get("tabId").and_then(Value::as_str),
                    "path": path,
                    "newName": new_name,
                }),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.file_browser.dangerous.delete" => {
            let path = args
                .get("path")
                .and_then(Value::as_str)
                .ok_or_else(|| "path is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "session_file_browser_delete",
                json!({
                    "tabId": args.get("tabId").and_then(Value::as_str),
                    "path": path,
                }),
            )
            .await;
            parse_tool_json(&raw)
        }
        // -- Workspace: remote desktop (RDP/VNC) capture and input ----------
        "kkterm.workspace.sessions.remote_desktop_screenshot" => {
            let raw = crate::ai::live_session_tool(
                app,
                "session_remote_desktop_screenshot",
                json!({"paneId": args.get("paneId").and_then(Value::as_str)}),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.dangerous.remote_desktop_send_text" => {
            let text = args
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| "text is required".to_string())?;
            let press_enter = args
                .get("pressEnter")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let raw = crate::ai::live_session_tool(
                app,
                "session_remote_desktop_send_text",
                json!({
                    "paneId": args.get("paneId").and_then(Value::as_str),
                    "text": text,
                    "pressEnter": press_enter,
                }),
            )
            .await;
            parse_tool_json(&raw)
        }
        "kkterm.workspace.dangerous.remote_desktop_keypress" => {
            let key = args
                .get("key")
                .and_then(Value::as_str)
                .ok_or_else(|| "key is required".to_string())?;
            let raw = crate::ai::live_session_tool(
                app,
                "session_remote_desktop_keypress",
                json!({
                    "paneId": args.get("paneId").and_then(Value::as_str),
                    "key": key,
                }),
            )
            .await;
            parse_tool_json(&raw)
        }
        // -- Network: read-only diagnostics. network_tool reads the same
        // camelCase argument keys the schema publishes, so forward as-is. A
        // failed probe is a real result (ok=false + netError), not a tool
        // error, so use passthrough parsing.
        "kkterm.network.ping" => {
            parse_passthrough_json(&crate::ai::network_tool("network_ping", args).await)
        }
        "kkterm.network.dns" => {
            parse_passthrough_json(&crate::ai::network_tool("network_dns", args).await)
        }
        "kkterm.network.tcp_check" => {
            parse_passthrough_json(&crate::ai::network_tool("network_tcp_check", args).await)
        }
        "kkterm.network.port_scan" => {
            parse_passthrough_json(&crate::ai::network_tool("network_port_scan", args).await)
        }
        "kkterm.network.interfaces" => {
            parse_passthrough_json(&crate::ai::network_tool("network_interfaces", args).await)
        }
        "kkterm.network.wol" => {
            parse_passthrough_json(&crate::ai::network_tool("network_wol", args).await)
        }
        "kkterm.network.whois" => {
            parse_passthrough_json(&crate::ai::network_tool("network_whois", args).await)
        }
        // -- Watchdog: background monitors ---------------------------------
        "kkterm.watchdog.list" => {
            parse_tool_json(&crate::ai::watchdog_tool(app, "watchdog_list", json!({})).await)
        }
        "kkterm.watchdog.get_report" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            parse_tool_json(
                &crate::ai::watchdog_tool(app, "watchdog_get_report", json!({"id": id})).await,
            )
        }
        "kkterm.watchdog.cancel" => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| "id is required".to_string())?;
            parse_tool_json(
                &crate::ai::watchdog_tool(app, "watchdog_cancel", json!({"id": id})).await,
            )
        }
        "kkterm.watchdog.dangerous.create" => {
            let config = args
                .get("config")
                .cloned()
                .ok_or_else(|| "config is required".to_string())?;
            parse_tool_json(
                &crate::ai::watchdog_tool(app, "watchdog_create", json!({"config": config})).await,
            )
        }
        // -- App: universal in-app window enumeration and capture -----------
        "kkterm.app.list_windows" => {
            let windows = crate::screenshot::list_app_windows(app)?;
            let windows = serde_json::to_value(windows).map_err(|error| error.to_string())?;
            Ok(json!({"ok": true, "windows": windows}))
        }
        "kkterm.app.dangerous.capture_window" => {
            let window_id = args
                .get("windowId")
                .and_then(Value::as_str)
                .ok_or_else(|| "windowId is required".to_string())?;
            // GDI screen-rect capture (use_directx=false) on Windows reliably
            // grabs WebView2 / remote-desktop content; xcap handles macOS/Linux.
            let screenshot = crate::screenshot::capture_app_window(app, window_id, false)?;
            let screenshot = serde_json::to_value(screenshot).map_err(|error| error.to_string())?;
            Ok(json!({"ok": true, "windowId": window_id, "screenshot": screenshot}))
        }
        "kkterm.app.dangerous.tutorial_highlight" => {
            parse_tool_json(&crate::ai::live_session_tool(app, "tutorial_highlight", args).await)
        }
        other => Err(format!("unknown tool: {other}")),
    }
}

/// `dashboard_tool` returns either a serialized success Value or a JSON
/// blob shaped like `{"error":"..."}` when something fails (see ai.rs).
/// Unify both shapes into a `Result<Value, String>` so the MCP layer can
/// emit a consistent tool-error response.
fn parse_dashboard_json(raw: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()));
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.to_string());
    }
    Ok(value)
}

fn parse_tool_json(raw: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string()));
    if value
        .get("ok")
        .and_then(Value::as_bool)
        .map(|ok| !ok)
        .unwrap_or(false)
    {
        let message = value
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| "tool returned ok=false".to_string());
        return Err(message);
    }
    Ok(value)
}

/// Network probes report real failures (host down, port closed) as
/// `{"ok": false, "netError": …}`. That is a legitimate diagnostic outcome,
/// not a tool-execution failure, so pass the payload through unchanged rather
/// than converting `ok=false` into an MCP tool error the way `parse_tool_json`
/// does. Only a genuinely unparseable response degrades to a string Value.
fn parse_passthrough_json(raw: &str) -> Result<Value, String> {
    Ok(serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.to_string())))
}

fn terminal_send_input_live_tool_args(pane_id: &str, text: &str, submit: bool) -> Value {
    let mut input = text.to_string();
    if submit {
        input.push('\r');
    }
    json!({"paneId": pane_id, "text": input, "pressEnter": false})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_info_path_uses_filename() {
        let path = bridge_info_path(Path::new("/tmp/x"));
        assert!(path.ends_with("mcp-bridge.json"));
    }

    #[test]
    fn send_input_submit_maps_to_terminal_enter_carriage_return() {
        let args = terminal_send_input_live_tool_args("pane-1", "hello", true);
        assert_eq!(
            args,
            json!({"paneId": "pane-1", "text": "hello\r", "pressEnter": false})
        );
    }

    #[test]
    fn parse_windows_user_sid_output_reads_csv_sid() {
        let sid =
            parse_windows_user_sid_output("\"DESKTOP-1\\alice\",\"S-1-5-21-111-222-333-1001\"\r\n")
                .unwrap();
        assert_eq!(sid, "S-1-5-21-111-222-333-1001");
    }

    #[test]
    fn parse_windows_user_sid_output_rejects_invalid_data() {
        assert!(parse_windows_user_sid_output("User Name,SID\r\n").is_err());
    }

    #[test]
    fn random_token_is_64_hex() {
        let token = random_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn parse_tool_json_extracts_error_message() {
        let raw = r#"{"ok": false, "error": "boom"}"#;
        let err = parse_tool_json(raw).unwrap_err();
        assert!(err.contains("boom"));
    }

    #[test]
    fn parse_tool_json_returns_value_when_ok_unset_or_true() {
        let value = parse_tool_json(r#"{"foo": 1}"#).unwrap();
        assert_eq!(value, json!({"foo": 1}));
        let value = parse_tool_json(r#"{"ok": true, "data": 2}"#).unwrap();
        assert_eq!(value, json!({"ok": true, "data": 2}));
    }

    #[test]
    fn redact_tool_arguments_hides_terminal_input_and_widget_source() {
        let send_input = redact_tool_arguments(
            "kkterm.workspace.sessions.dangerous.send_input",
            &json!({"paneId": "pane-1", "text": "password", "submit": true}),
        );
        assert_eq!(send_input["text"], "[REDACTED]");
        assert_eq!(send_input["paneId"], "pane-1");

        let remote_text = redact_tool_arguments(
            "kkterm.workspace.dangerous.remote_desktop_send_text",
            &json!({"paneId": "pane-2", "text": "secret", "pressEnter": true}),
        );
        assert_eq!(remote_text["text"], "[REDACTED]");
        assert_eq!(remote_text["paneId"], "pane-2");

        let create_widget = redact_tool_arguments(
            "kkterm.dashboard.dangerous.create_widget",
            &json!({
                "body": {"source": "const secret = true;", "permissions": {"network": false}},
                "bodyJson": "{\"source\":\"fallback\"}",
                "apiKey": "key-1"
            }),
        );
        assert_eq!(create_widget["body"]["source"], "[REDACTED]");
        assert_eq!(create_widget["bodyJson"], "[REDACTED]");
        assert_eq!(create_widget["apiKey"], "[REDACTED]");

        let update_widget = redact_tool_arguments(
            "kkterm.dashboard.dangerous.update_custom_widget",
            &json!({
                "id": "cw_1",
                "patch": {
                    "body": {"source": "const next = true;"},
                    "bodyJson": "{\"source\":\"legacy\"}"
                }
            }),
        );
        assert_eq!(update_widget["patch"]["body"]["source"], "[REDACTED]");
        assert_eq!(update_widget["patch"]["bodyJson"], "[REDACTED]");
    }

    #[test]
    fn redact_bridge_request_hides_tool_arguments() {
        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "kkterm.workspace.sessions.dangerous.send_input",
                "arguments": {"paneId": "pane-1", "text": "secret"}
            }
        });

        let redacted = redact_bridge_request(&request);

        assert_eq!(redacted["params"]["arguments"]["text"], "[REDACTED]");
        assert_eq!(request["params"]["arguments"]["text"], "secret");
    }

    #[test]
    fn redact_tool_result_hides_terminal_buffer_and_widget_source_reads() {
        assert_eq!(
            redact_tool_result(
                "kkterm.workspace.sessions.read_buffer",
                &json!({"text": "terminal output"})
            ),
            json!("[REDACTED]")
        );
        assert_eq!(
            redact_tool_result(
                "kkterm.dashboard.read_widget_source",
                &json!({"bodyJson": "{\"source\":\"secret\"}"})
            ),
            json!("[REDACTED]")
        );
        assert_eq!(
            redact_tool_result(
                "kkterm.itops.tasks.get",
                &json!({"task": {"kind": "script", "body": "token=secret"}})
            ),
            json!("[REDACTED]")
        );
        assert_eq!(
            redact_tool_result(
                "kkterm.itops.automations.list",
                &json!([{"actions": [{"kind": "runBatch", "task": {"kind": "script", "body": "token=secret"}}]}])
            ),
            json!("[REDACTED]")
        );
    }

    #[test]
    fn screenshot_and_itops_image_data_is_redacted_from_debug_logs() {
        let screenshot = redact_tool_result(
            "kkterm.screenshots.dangerous.read",
            &json!({"dataUrl": "data:image/png;base64,secret", "thumbnailDataUrl": "data:image/jpeg;base64,secret"}),
        );
        assert_eq!(screenshot["dataUrl"], "[REDACTED]");
        assert_eq!(screenshot["thumbnailDataUrl"], "[REDACTED]");

        let background = redact_tool_arguments(
            "kkterm.itops.sites.set_background",
            &json!({"siteId": "site-1", "background": {"dataUrl": "data:image/png;base64,secret"}}),
        );
        assert_eq!(background["background"]["dataUrl"], "[REDACTED]");
    }

    #[test]
    fn redact_bridge_response_hides_structured_content_copy() {
        let response = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "content": [{"type": "text", "text": "{\"bodyJson\":\"secret\"}"}],
                "structuredContent": {"bodyJson": "{\"source\":\"secret\"}"},
                "isError": false
            }
        });

        let redacted = redact_bridge_response(&response);

        assert_eq!(
            redacted["result"]["content"][0]["text"],
            "[REDACTED: see bridge.tool_result]"
        );
        assert_eq!(
            redacted["result"]["structuredContent"],
            "[REDACTED: see bridge.tool_result]"
        );
    }

    #[test]
    fn dangerous_tool_detection() {
        assert!(dangerous_tool("kkterm.workspace.dangerous.pointer_click"));
        assert!(dangerous_tool(
            "kkterm.workspace.quick_commands.dangerous.create"
        ));
        assert!(dangerous_tool(
            "kkterm.workspace.quick_commands.dangerous.edit"
        ));
        assert!(dangerous_tool("kkterm.dashboard.dangerous.create_widget"));
        assert!(dangerous_tool("kkterm.dashboard.dangerous.reset"));
        assert!(dangerous_tool(
            "kkterm.workspace.file_browser.dangerous.create_folder"
        ));
        assert!(dangerous_tool(
            "kkterm.workspace.file_browser.dangerous.delete"
        ));
        assert!(dangerous_tool(
            "kkterm.workspace.dangerous.remote_desktop_send_text"
        ));
        assert!(dangerous_tool(
            "kkterm.workspace.dangerous.remote_desktop_keypress"
        ));
        assert!(dangerous_tool("kkterm.watchdog.dangerous.create"));
        assert!(dangerous_tool("kkterm.app.dangerous.capture_window"));
        assert!(!dangerous_tool("kkterm.app.list_windows"));
        assert!(dangerous_tool(
            "kkterm.workspace.sessions.dangerous.send_input"
        ));
        assert!(dangerous_tool(
            "kkterm.workspace.workspaces.dangerous.delete"
        ));
        assert!(!dangerous_tool("kkterm.workspace.file_browser.list"));
        assert!(!dangerous_tool(
            "kkterm.workspace.sessions.remote_desktop_screenshot"
        ));
        assert!(!dangerous_tool("kkterm.workspace.quick_commands.list"));
        assert!(!dangerous_tool("kkterm.workspace.quick_commands.read"));
        assert!(!dangerous_tool("kkterm.dashboard.add_instance"));
        assert!(!dangerous_tool("kkterm.dashboard.update_view"));
        assert!(!dangerous_tool("kkterm.network.ping"));
        assert!(!dangerous_tool("kkterm.network.port_scan"));
        assert!(!dangerous_tool("kkterm.watchdog.list"));
        assert!(!dangerous_tool("kkterm.watchdog.cancel"));
        assert!(dangerous_tool("kkterm.screenshots.dangerous.read"));
        assert!(dangerous_tool(
            "kkterm.screenshots.dangerous.capture_fullscreen"
        ));
        assert!(!dangerous_tool("kkterm.screenshots.list"));
    }

    #[test]
    fn tool_descriptors_include_published_surface() {
        let names: Vec<String> = crate::mcp_tool_catalog::tool_descriptors()
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
            .collect();
        assert!(names.contains(&"kkterm.workspace.workspaces.list".to_string()));
        assert!(names.contains(&"kkterm.workspace.workspaces.create".to_string()));
        assert!(names.contains(&"kkterm.workspace.workspaces.rename".to_string()));
        assert!(names.contains(&"kkterm.workspace.workspaces.reorder".to_string()));
        assert!(names.contains(&"kkterm.workspace.workspaces.dangerous.delete".to_string()));
        assert!(names.contains(&"kkterm.workspace.connections.open".to_string()));
        assert!(names.contains(&"kkterm.workspace.connections.create".to_string()));
        assert!(names.contains(&"kkterm.workspace.connections.update".to_string()));
        assert!(names.contains(&"kkterm.workspace.connections.rename".to_string()));
        assert!(names.contains(&"kkterm.workspace.connections.delete".to_string()));
        assert!(names.contains(&"kkterm.workspace.connections.move".to_string()));
        assert!(names.contains(&"kkterm.workspace.connection_folders.create".to_string()));
        assert!(names.contains(&"kkterm.workspace.connection_folders.rename".to_string()));
        assert!(names.contains(&"kkterm.workspace.connection_folders.delete".to_string()));
        assert!(names.contains(&"kkterm.workspace.connection_folders.move".to_string()));
        assert!(names.contains(&"kkterm.workspace.connections.screenshot".to_string()));
        assert!(names.contains(&"kkterm.workspace.sessions.dangerous.send_input".to_string()));
        assert!(names.contains(&"kkterm.workspace.sessions.read_buffer".to_string()));
        assert!(names.contains(&"kkterm.workspace.quick_commands.list".to_string()));
        assert!(names.contains(&"kkterm.workspace.quick_commands.read".to_string()));
        assert!(names.contains(&"kkterm.workspace.quick_commands.dangerous.create".to_string()));
        assert!(names.contains(&"kkterm.workspace.quick_commands.dangerous.edit".to_string()));
        assert!(names.contains(&"kkterm.workspace.dangerous.pointer_click".to_string()));
        // Dashboard surface
        assert!(names.contains(&"kkterm.dashboard.load_state".to_string()));
        assert!(names.contains(&"kkterm.dashboard.check_widget_health".to_string()));
        assert!(names.contains(&"kkterm.dashboard.screenshot_view".to_string()));
        assert!(names.contains(&"kkterm.dashboard.screenshot_widget".to_string()));
        assert!(names.contains(&"kkterm.dashboard.create_view".to_string()));
        assert!(names.contains(&"kkterm.dashboard.update_view".to_string()));
        assert!(names.contains(&"kkterm.dashboard.add_instance".to_string()));
        assert!(names.contains(&"kkterm.dashboard.update_instance".to_string()));
        assert!(names.contains(&"kkterm.dashboard.apply_layout".to_string()));
        assert!(names.contains(&"kkterm.dashboard.dangerous.create_widget".to_string()));
        assert!(names.contains(&"kkterm.dashboard.dangerous.update_custom_widget".to_string()));
        assert!(names.contains(&"kkterm.dashboard.dangerous.reset".to_string()));
        // File browser surface
        assert!(names.contains(&"kkterm.workspace.file_browser.list".to_string()));
        assert!(
            names.contains(&"kkterm.workspace.file_browser.dangerous.create_folder".to_string())
        );
        assert!(names.contains(&"kkterm.workspace.file_browser.dangerous.rename".to_string()));
        assert!(names.contains(&"kkterm.workspace.file_browser.dangerous.delete".to_string()));
        // Remote desktop surface
        assert!(names.contains(&"kkterm.workspace.sessions.remote_desktop_screenshot".to_string()));
        assert!(names.contains(&"kkterm.workspace.dangerous.remote_desktop_send_text".to_string()));
        assert!(names.contains(&"kkterm.workspace.dangerous.remote_desktop_keypress".to_string()));
        for name in [
            "kkterm.screenshots.list",
            "kkterm.screenshots.dangerous.read",
            "kkterm.screenshots.rename",
            "kkterm.screenshots.copy_to_clipboard",
            "kkterm.screenshots.resize",
            "kkterm.screenshots.convert",
            "kkterm.screenshots.dangerous.save_edited",
            "kkterm.screenshots.dangerous.delete",
            "kkterm.screenshots.dangerous.delete_batch",
            "kkterm.screenshots.dangerous.clear",
            "kkterm.screenshots.open_folder",
            "kkterm.screenshots.reveal",
            "kkterm.screenshots.open_file",
            "kkterm.screenshots.dangerous.capture_rect",
            "kkterm.screenshots.dangerous.capture_region",
            "kkterm.screenshots.dangerous.capture_window",
            "kkterm.screenshots.dangerous.capture_fullscreen",
        ] {
            assert!(names.contains(&name.to_string()));
        }
        // IT Ops surface
        assert!(names.contains(&"kkterm.itops.sites.list".to_string()));
        assert!(names.contains(&"kkterm.itops.sites.create".to_string()));
        assert!(names.contains(&"kkterm.itops.server_rooms.list".to_string()));
        assert!(names.contains(&"kkterm.itops.server_rooms.create".to_string()));
        assert!(names.contains(&"kkterm.itops.racks.list".to_string()));
        assert!(names.contains(&"kkterm.itops.racks.create".to_string()));
        assert!(names.contains(&"kkterm.itops.rack_items.place".to_string()));
        assert!(names.contains(&"kkterm.itops.rack_items.update".to_string()));
        assert!(names.contains(&"kkterm.itops.rack_items.move".to_string()));
        assert!(names.contains(&"kkterm.itops.rack_items.remove".to_string()));
        assert!(names.contains(&"kkterm.itops.hosts.list".to_string()));
        assert!(names.contains(&"kkterm.itops.sites.update".to_string()));
        assert!(names.contains(&"kkterm.itops.sites.remove".to_string()));
        assert!(names.contains(&"kkterm.itops.server_rooms.update".to_string()));
        assert!(names.contains(&"kkterm.itops.server_rooms.remove".to_string()));
        assert!(names.contains(&"kkterm.itops.racks.update".to_string()));
        assert!(names.contains(&"kkterm.itops.racks.remove".to_string()));
        assert!(names.contains(&"kkterm.itops.hosts.create".to_string()));
        assert!(names.contains(&"kkterm.itops.hosts.update".to_string()));
        assert!(names.contains(&"kkterm.itops.hosts.remove".to_string()));
        assert!(names.contains(&"kkterm.itops.hosts.import".to_string()));
        assert!(names.contains(&"kkterm.itops.hosts.scan".to_string()));
        for name in [
            "kkterm.itops.sites.reorder",
            "kkterm.itops.sites.resolve",
            "kkterm.itops.sites.set_background",
            "kkterm.itops.server_rooms.duplicate",
            "kkterm.itops.server_rooms.set_background",
            "kkterm.itops.server_rooms.set_icon",
            "kkterm.itops.racks.duplicate",
            "kkterm.itops.racks.reorder",
            "kkterm.itops.racks.set_placements",
            "kkterm.itops.racks.set_facings",
            "kkterm.itops.racks.set_background",
            "kkterm.itops.rack_items.refresh_snmp",
            "kkterm.itops.room_objects.list",
            "kkterm.itops.room_objects.set",
            "kkterm.itops.connections.get",
        ] {
            assert!(names.contains(&name.to_string()));
        }
        assert!(names.contains(&"kkterm.itops.tasks.list".to_string()));
        assert!(names.contains(&"kkterm.itops.tasks.get".to_string()));
        assert!(names.contains(&"kkterm.itops.tasks.dangerous.create".to_string()));
        assert!(names.contains(&"kkterm.itops.tasks.dangerous.update".to_string()));
        assert!(names.contains(&"kkterm.itops.tasks.remove".to_string()));
        assert!(names.contains(&"kkterm.itops.automations.list".to_string()));
        assert!(names.contains(&"kkterm.itops.automations.dangerous.create".to_string()));
        assert!(names.contains(&"kkterm.itops.automations.dangerous.update".to_string()));
        assert!(names.contains(&"kkterm.itops.automations.dangerous.set_enabled".to_string()));
        assert!(names.contains(&"kkterm.itops.automations.remove".to_string()));
        assert!(names.contains(&"kkterm.itops.automations.test".to_string()));
        assert!(names.contains(&"kkterm.itops.runs.dangerous.start".to_string()));
        assert!(names.contains(&"kkterm.itops.runs.cancel".to_string()));
        assert!(names.contains(&"kkterm.itops.runs.list".to_string()));
        assert!(names.contains(&"kkterm.itops.runs.get_report".to_string()));
        // Network surface
        assert!(names.contains(&"kkterm.network.ping".to_string()));
        assert!(names.contains(&"kkterm.network.dns".to_string()));
        assert!(names.contains(&"kkterm.network.tcp_check".to_string()));
        assert!(names.contains(&"kkterm.network.port_scan".to_string()));
        assert!(names.contains(&"kkterm.network.interfaces".to_string()));
        assert!(names.contains(&"kkterm.network.wol".to_string()));
        assert!(names.contains(&"kkterm.network.whois".to_string()));
        // Watchdog surface
        assert!(names.contains(&"kkterm.watchdog.list".to_string()));
        assert!(names.contains(&"kkterm.watchdog.get_report".to_string()));
        assert!(names.contains(&"kkterm.watchdog.cancel".to_string()));
        assert!(names.contains(&"kkterm.watchdog.dangerous.create".to_string()));
        // App window capture surface
        assert!(names.contains(&"kkterm.app.list_windows".to_string()));
        assert!(names.contains(&"kkterm.app.dangerous.capture_window".to_string()));
        assert!(names.contains(&"kkterm.app.dangerous.tutorial_highlight".to_string()));
        // Guard against drifting back to the pre-Option-B flat namespace.
        for name in &names {
            assert!(
                !name.starts_with("kkterm.connections.")
                    && !name.starts_with("kkterm.sessions.")
                    && !name.starts_with("kkterm.dangerous."),
                "stale top-level tool name leaked: {name}",
            );
        }
    }

    #[test]
    fn rack_item_descriptor_exposes_rack_top_kuaiguai_contract() {
        let tools = crate::mcp_tool_catalog::tool_descriptors();
        let place = tools
            .iter()
            .find(|tool| {
                tool.get("name").and_then(Value::as_str) == Some("kkterm.itops.rack_items.place")
            })
            .expect("rack item placement descriptor exists");
        let kinds = place
            .pointer("/inputSchema/properties/kind/enum")
            .and_then(Value::as_array)
            .expect("rack item kind enum exists");

        assert!(kinds.contains(&json!("kuaiguai")));
        assert!(
            place
                .get("description")
                .and_then(Value::as_str)
                .is_some_and(|description| description.contains("rack.heightU + 1"))
        );
        assert_eq!(
            place.pointer("/inputSchema/properties/metadata/properties/expiry/type"),
            Some(&json!("string"))
        );
        for name in [
            "kkterm.itops.rack_items.place",
            "kkterm.itops.rack_items.update",
            "kkterm.itops.rack_items.move",
        ] {
            let descriptor = tools
                .iter()
                .find(|tool| tool.get("name").and_then(Value::as_str) == Some(name))
                .expect("rack item descriptor exists");
            assert_eq!(
                descriptor.pointer("/inputSchema/properties/mountFace/enum"),
                Some(&json!(["front", "rear"])),
                "{name} must publish the mounting-face field accepted by itops_tool",
            );
        }
    }

    #[test]
    fn connection_descriptor_matches_supported_local_surface_types() {
        let tools = crate::mcp_tool_catalog::tool_descriptors();
        let create = tools
            .iter()
            .find(|tool| {
                tool.get("name").and_then(Value::as_str)
                    == Some("kkterm.workspace.connections.create")
            })
            .expect("Connection create descriptor exists");
        let types = create
            .pointer("/inputSchema/properties/type/enum")
            .and_then(Value::as_array)
            .expect("Connection type enum exists");

        assert!(types.contains(&json!("localFiles")));
        assert!(types.contains(&json!("fileView")));
        assert_eq!(
            create.pointer("/inputSchema/properties/workspaceId/type"),
            Some(&json!(["string", "null"]))
        );
        for property in [
            "sshSocksProxy",
            "sshCompression",
            "sshOldProtocols",
            "urlUserAgent",
            "urlProxy",
            "rdpOptions",
            "vncOptions",
            "ftpOptions",
            "sshPortForwardings",
            "fileViewOpenExternal",
        ] {
            assert!(
                create
                    .pointer(&format!("/inputSchema/properties/{property}"))
                    .is_some(),
                "Connection schema must publish the {property} field accepted by storage",
            );
        }
        assert_eq!(
            create.pointer("/inputSchema/properties/rdpOptions/properties/sharedLocalFolder/type"),
            Some(&json!(["string", "null"])),
        );
    }

    #[test]
    fn parse_dashboard_json_unwraps_error_field() {
        let raw = r#"{"error":"view not found"}"#;
        let err = parse_dashboard_json(raw).unwrap_err();
        assert_eq!(err, "view not found");
    }

    #[test]
    fn parse_dashboard_json_passes_success_payload_through() {
        let raw = r#"{"id":"view_abc","title":"Ops"}"#;
        let value = parse_dashboard_json(raw).unwrap();
        assert_eq!(value, json!({"id": "view_abc", "title": "Ops"}));
    }
}

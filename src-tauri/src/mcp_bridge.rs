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

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(target_os = "windows")]
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

const PROTOCOL_VERSION: &str = "2025-03-26";
const SERVER_NAME: &str = "kkterm-cli";
const BRIDGE_INFO_FILENAME: &str = "mcp-bridge.json";
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
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(target_os = "windows")]
    restrict_file_to_current_user(path);
    Ok(())
}

/// Tighten the DACL on the bridge-info file so only the current Windows user
/// can read or write it.  Uses `icacls` (available on Vista+):
///   /inheritance:r  — strip inherited ACEs
///   /grant:r        — replace explicit grants with owner-only full control
/// Failures are non-fatal; the named-pipe token still protects the bridge.
#[cfg(target_os = "windows")]
fn restrict_file_to_current_user(path: &Path) {
    let Some(path_str) = path.to_str() else {
        return;
    };
    let Ok(username) = std::env::var("USERNAME") else {
        return;
    };
    let grant_arg = format!("{username}:(F)");
    let _ = std::process::Command::new("icacls")
        .args([path_str, "/inheritance:r", "/grant:r", &grant_arg])
        .output();
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

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, allow_all_dangerous);
        crate::logging::mcp_debug("bridge.unsupported_platform", &json!({}));
        eprintln!(
            "kkterm built-in MCP server: named-pipe transport is Windows-only; bridge disabled."
        );
    }

    #[cfg(target_os = "windows")]
    {
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

#[cfg(target_os = "windows")]
async fn serve_client(ctx: Arc<BridgeContext>, stream: NamedPipeServer) -> std::io::Result<()> {
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
        crate::logging::mcp_debug("bridge.request", &request);
        let response = handle_request(&ctx, request).await;
        if let Some(response) = response {
            crate::logging::mcp_debug("bridge.response", &response);
            write_response(&mut writer, &response).await?;
        }
    }
}

#[cfg(target_os = "windows")]
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
            "result": {"tools": tool_descriptors()},
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

fn tool_descriptors() -> Vec<Value> {
    vec![
        json!({
            "name": "kkterm.workspace.connections.list",
            "description": "List saved Connections (folders + connections) from KKTerm storage.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.workspace.connections.open",
            "description": "Open a saved Connection by its id. Starts the appropriate session (terminal, SSH, URL, RDP, VNC) inside the running KKTerm app.",
            "inputSchema": {
                "type": "object",
                "properties": {"connectionId": {"type": "string"}},
                "required": ["connectionId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.connections.screenshot",
            "description": "Capture the visible Workspace surface for an open Connection by id. The app activates the Connection tab before capturing and returns a JPEG data URL plus dimensions.",
            "inputSchema": {
                "type": "object",
                "properties": {"connectionId": {"type": "string"}},
                "required": ["connectionId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.sessions.list",
            "description": "List live Sessions (terminal Panes, remote desktop targets, file browsers).",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.workspace.sessions.send_input",
            "description": "Send text/keystrokes to a live terminal Pane.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string"},
                    "text": {"type": "string"},
                    "submit": {"type": "boolean", "description": "Append a terminal Enter key (carriage return) after the text."},
                },
                "required": ["paneId", "text"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.sessions.read_buffer",
            "description": "Read a snapshot of the visible terminal buffer for a live Pane.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string"},
                },
                "required": ["paneId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.quick_commands.list",
            "description": "List saved Quick Commands for one Connection's Quick Command Bar.",
            "inputSchema": {
                "type": "object",
                "properties": {"connectionId": {"type": "string"}},
                "required": ["connectionId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.quick_commands.read",
            "description": "Read one saved Quick Command from a Connection's Quick Command Bar by id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connectionId": {"type": "string"},
                    "id": {"type": "string"},
                },
                "required": ["connectionId", "id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.quick_commands.dangerous.create",
            "description": "DANGEROUS: create a saved Quick Command for one Connection's Quick Command Bar. This saves a runnable shortcut but does not execute it. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connectionId": {"type": "string"},
                    "label": {"type": "string"},
                    "command": {"type": "string"},
                    "iconName": {"type": "string"},
                    "accentName": {"type": "string"},
                    "sendEnter": {"type": "boolean"},
                    "confirm": {"type": "boolean"},
                },
                "required": ["connectionId", "label", "command"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.quick_commands.dangerous.edit",
            "description": "DANGEROUS: edit one saved Quick Command for a Connection's Quick Command Bar. This updates a runnable shortcut but does not execute it. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connectionId": {"type": "string"},
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "command": {"type": "string"},
                    "iconName": {"type": "string"},
                    "accentName": {"type": "string"},
                    "sendEnter": {"type": "boolean"},
                    "confirm": {"type": "boolean"},
                },
                "required": ["connectionId", "id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.dangerous.pointer_click",
            "description": "DANGEROUS: send a mouse click to a live RDP/VNC remote desktop surface. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string"},
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "button": {"type": "string", "enum": ["left", "right", "middle"]},
                },
                "required": ["paneId", "x", "y"],
                "additionalProperties": false,
            },
        }),
        // -- Dashboard: views, instances, layout --------------------------
        json!({
            "name": "kkterm.dashboard.load_state",
            "description": "Load full Dashboard state: views, instances, and AI-Created Widget metadata. Widget bodies are returned as `bodyMeta` (size, library hints); call read_widget_source to fetch the actual script.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.dashboard.screenshot_view",
            "description": "Capture an entire Dashboard View. If viewId is omitted, captures the active Dashboard View. Returns a JPEG data URL plus dimensions.",
            "inputSchema": {
                "type": "object",
                "properties": {"viewId": {"type": "string"}},
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.screenshot_widget",
            "description": "Capture a single Dashboard Widget Instance region by id. The app activates the owning Dashboard View before capturing and returns a JPEG data URL plus dimensions.",
            "inputSchema": {
                "type": "object",
                "properties": {"instanceId": {"type": "string"}},
                "required": ["instanceId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.read_widget_source",
            "description": "Fetch the script body of a single AI-Created Widget by id.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.create_view",
            "description": "Add a new Dashboard view (tab). `gridDensity` is optional ('cozy' | 'compact'); defaults to the app default.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "gridDensity": {"type": "string"},
                },
                "required": ["title"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.update_view",
            "description": "Edit an existing Dashboard view. `patch` supports the same fields as create_view (title, gridDensity).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {"type": "object"},
                },
                "required": ["id", "patch"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.remove_view",
            "description": "Delete a Dashboard view and all its instances.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.reorder_views",
            "description": "Reorder Dashboard views by supplying their ids in the desired order.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "orderedIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["orderedIds"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.add_instance",
            "description": "Place a new widget instance on a view. For built-in widgets, set kind to e.g. 'connection', 'app_launcher', etc. For AI-Created Widgets, set kind = 'script' and sourceId to the widget's id. Grid coordinates are 0-11 columns wide.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "viewId": {"type": "string"},
                    "kind": {"type": "string"},
                    "sourceId": {"type": "string"},
                    "preset": {"type": "string"},
                    "accentName": {"type": "string"},
                    "iconName": {"type": "string"},
                    "gridX": {"type": "integer", "minimum": 0, "maximum": 11},
                    "gridY": {"type": "integer", "minimum": 0},
                    "gridW": {"type": "integer", "minimum": 1, "maximum": 12},
                    "gridH": {"type": "integer", "minimum": 1},
                },
                "required": ["viewId", "kind"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.update_instance",
            "description": "Change a widget instance's size, position, preset, accent, or icon. Use `patch` with any subset of: gridX, gridY, gridW, gridH, preset, accentName, iconName.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {"type": "object"},
                },
                "required": ["id", "patch"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.remove_instance",
            "description": "Remove a widget instance from its view.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.apply_layout",
            "description": "Bulk update of multiple instance positions on a single view. `layout` is an array of {id, gridX, gridY, gridW, gridH} entries.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "viewId": {"type": "string"},
                    "layout": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "gridX": {"type": "integer"},
                                "gridY": {"type": "integer"},
                                "gridW": {"type": "integer"},
                                "gridH": {"type": "integer"},
                            },
                            "required": ["id"],
                        },
                    },
                },
                "required": ["viewId", "layout"],
                "additionalProperties": false,
            },
        }),
        // -- Dashboard: AI-Created Widget management (executes user scripts) --
        json!({
            "name": "kkterm.dashboard.dangerous.create_widget",
            "description": "DANGEROUS: create an AI-Created (script) Widget AND place it on a view in one call. `widgetArchetype` selects the generation scaffold (dataMonitor, metricChart, utilityInstrument, desktopObject, canvasToyGame, or generalWorkbench). `body` is the structured widget body (libraries, source, permissions, etc.). Requires built_in_mcp_allow_all_dangerous = true because the body runs as a sandboxed script widget.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "viewId": {"type": "string"},
                    "widgetArchetype": {"type": "string", "enum": ["dataMonitor", "metricChart", "utilityInstrument", "desktopObject", "canvasToyGame", "generalWorkbench"]},
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "category": {"type": "string"},
                    "body": {"type": "object"},
                    "settingsSchema": {"type": "object"},
                    "preset": {"type": "string"},
                    "accentName": {"type": "string"},
                    "iconName": {"type": "string"},
                    "gridX": {"type": "integer"},
                    "gridY": {"type": "integer"},
                    "gridW": {"type": "integer"},
                    "gridH": {"type": "integer"},
                },
                "required": ["viewId", "widgetArchetype", "title", "body"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.dangerous.create_custom_widget",
            "description": "DANGEROUS: create a reusable AI-Created Widget definition without placing it. Pass `bodyJson` as a UTF-8 JSON string matching the script body schema. Requires Allow-all.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "category": {"type": "string"},
                    "bodyJson": {"type": "string"},
                    "settingsSchemaJson": {"type": "string"},
                    "createdBy": {"type": "string"},
                },
                "required": ["title", "bodyJson"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.dangerous.update_custom_widget",
            "description": "DANGEROUS: edit an existing AI-Created Widget. `patch` may include title, summary, category, and a structured `body` (preferred) or `bodyJson`. Requires Allow-all because changes alter executable widget code.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {"type": "object"},
                },
                "required": ["id", "patch"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.dangerous.remove_custom_widget",
            "description": "DANGEROUS: delete an AI-Created Widget definition. `forceDeleteInstances` removes existing instances too; otherwise the call fails if any instance still references it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "forceDeleteInstances": {"type": "boolean"},
                },
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.dangerous.reset",
            "description": "DANGEROUS: wipe the entire Dashboard — all views, instances, and AI-Created Widgets. Irreversible. Requires Allow-all.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
    ]
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
        &json!({"name": name.clone(), "arguments": arguments.clone()}),
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
                &json!({"name": name.clone(), "result": value.clone()}),
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

async fn dispatch_tool(app: &AppHandle, name: &str, args: Value) -> Result<Value, String> {
    match name {
        "kkterm.workspace.connections.list" => {
            let raw = crate::ai::connection_tool(app, "connection_list", json!({}));
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
        "kkterm.workspace.sessions.send_input" => {
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
            // Pass through every recognised placement field; the AI tool
            // applies sensible defaults for anything missing.
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
        assert!(!dangerous_tool("kkterm.workspace.sessions.send_input"));
        assert!(!dangerous_tool("kkterm.workspace.quick_commands.list"));
        assert!(!dangerous_tool("kkterm.workspace.quick_commands.read"));
        assert!(!dangerous_tool("kkterm.dashboard.add_instance"));
        assert!(!dangerous_tool("kkterm.dashboard.update_view"));
    }

    #[test]
    fn tool_descriptors_include_published_surface() {
        let names: Vec<String> = tool_descriptors()
            .iter()
            .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
            .collect();
        assert!(names.contains(&"kkterm.workspace.connections.open".to_string()));
        assert!(names.contains(&"kkterm.workspace.connections.screenshot".to_string()));
        assert!(names.contains(&"kkterm.workspace.sessions.send_input".to_string()));
        assert!(names.contains(&"kkterm.workspace.sessions.read_buffer".to_string()));
        assert!(names.contains(&"kkterm.workspace.quick_commands.list".to_string()));
        assert!(names.contains(&"kkterm.workspace.quick_commands.read".to_string()));
        assert!(names.contains(&"kkterm.workspace.quick_commands.dangerous.create".to_string()));
        assert!(names.contains(&"kkterm.workspace.quick_commands.dangerous.edit".to_string()));
        assert!(names.contains(&"kkterm.workspace.dangerous.pointer_click".to_string()));
        // Dashboard surface
        assert!(names.contains(&"kkterm.dashboard.load_state".to_string()));
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

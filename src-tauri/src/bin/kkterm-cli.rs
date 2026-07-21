// kkterm-cli: stdio MCP server binary.
//
// Acts as a thin forwarder between an external MCP client (Claude Desktop,
// Codex, etc.) and the live KKTerm app over a Windows named pipe. The real
// JSON-RPC routing and tool handlers live inside kkterm.exe — see
// `src-tauri/src/mcp_bridge.rs`. This binary intentionally has no business
// logic of its own; when the app is not running it returns a structured
// JSON-RPC error so MCP clients render it readably.

use std::io::IsTerminal;
use std::path::PathBuf;
use std::process::ExitCode;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::time::{Duration, timeout};

// Share the one MCP tool catalog with the in-app bridge so offline
// `tools/list` never drifts from the live surface. Included by path (rather
// than `use kkterm_lib::...`) so this thin forwarder does not link the whole
// app crate; the catalog depends only on serde_json. See mcp_tool_catalog.rs.
#[path = "../mcp_tool_catalog.rs"]
mod mcp_tool_catalog;

// Share the portable-mode marker filename with the in-app launcher so the CLI's
// sibling-bridge lookup can never drift from `app_paths.rs`. Included by path
// for the same thin-forwarder reason as the tool catalog above; the module has
// no dependencies. See portable_marker.rs.
#[path = "../portable_marker.rs"]
mod portable_marker;
use portable_marker::PORTABLE_MARKER_FILENAME;

// Share the bundle identifier with the app crate so the CLI's installed-mode
// app-data path can never drift from the folder Tauri actually uses. Included
// by path for the same thin-forwarder reason as the modules above; it has no
// dependencies. See bundle_identifier.rs.
#[path = "../bundle_identifier.rs"]
mod bundle_identifier;
use bundle_identifier::BUNDLE_IDENTIFIER;

const BRIDGE_INFO_FILENAME: &str = "mcp-bridge.json";
const PROTOCOL_VERSION: &str = "2025-03-26";
const SERVER_NAME: &str = "kkterm-cli";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

const HELP: &str = "kkterm-cli - KKTerm built-in MCP stdio server\n\nUsage:\n  kkterm-cli              Start the MCP server when stdin is piped; show this help in a terminal\n  kkterm-cli mcp          Start the MCP stdio server\n  kkterm-cli help         Show this help\n\nOptions:\n  -h, --help, -help       Show this help\n  -?, /?, /h, /help       Show this help\n  -V, --version           Show the version\n";

#[derive(Debug, PartialEq, Eq)]
enum CliAction {
    Serve,
    Help,
    Version,
    Invalid(String),
}

fn cli_action(args: &[String], stdin_is_terminal: bool) -> CliAction {
    match args {
        [] if stdin_is_terminal => CliAction::Help,
        [] => CliAction::Serve,
        [arg] if matches!(arg.as_str(), "mcp" | "serve") => CliAction::Serve,
        [arg]
            if matches!(
                arg.as_str(),
                "help" | "-h" | "--help" | "-help" | "-?" | "/?" | "/h" | "/help"
            ) =>
        {
            CliAction::Help
        }
        [arg] if matches!(arg.as_str(), "-V" | "--version" | "version") => CliAction::Version,
        _ => CliAction::Invalid(args.join(" ")),
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match cli_action(&args, std::io::stdin().is_terminal()) {
        CliAction::Help => {
            print!("{HELP}");
            ExitCode::SUCCESS
        }
        CliAction::Version => {
            println!("kkterm-cli {SERVER_VERSION}");
            ExitCode::SUCCESS
        }
        CliAction::Invalid(args) => {
            let _ = writeln_stderr(&format!("unknown argument: {args}\n\n{HELP}"));
            ExitCode::from(2)
        }
        CliAction::Serve => {
            if let Err(error) = run().await {
                let _ = writeln_stderr(&format!("kkterm-cli MCP error: {error}"));
                return ExitCode::from(1);
            }
            ExitCode::SUCCESS
        }
    }
}

async fn run() -> std::io::Result<()> {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).await?;
        if bytes == 0 {
            return Ok(());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                write_line(
                    &mut stdout,
                    &json!({
                        "jsonrpc": "2.0",
                        "id": Value::Null,
                        "error": {"code": -32700, "message": format!("parse error: {error}")},
                    }),
                )
                .await?;
                continue;
            }
        };
        if let Some(response) = handle_request(request).await {
            write_line(&mut stdout, &response).await?;
        }
    }
}

async fn handle_request(request: Value) -> Option<Value> {
    let is_notification = request.get("id").is_none();
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if is_notification && method != "notifications/initialized" {
        return None;
    }

    match method.as_str() {
        "initialize"
            if request
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .is_some_and(|version| version != PROTOCOL_VERSION) =>
        {
            Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32602,
                    "message": format!(
                        "unsupported MCP protocol version; kkterm-cli supports {PROTOCOL_VERSION}"
                    )
                }
            }))
        }
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "capabilities": {"tools": {}},
            },
        })),
        "notifications/initialized" => None,
        "ping" => Some(json!({"jsonrpc": "2.0", "id": id, "result": {}})),
        // Static tools/list so MCP clients can discover the surface even
        // when KKTerm.exe isn't running. tools/call still requires a live
        // bridge so dispatch falls through to forward(). The descriptors come
        // from the shared catalog so they match the live bridge exactly.
        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {"tools": mcp_tool_catalog::tool_descriptors()},
        })),
        _ => Some(forward(id, request).await),
    }
}

async fn forward(id: Value, request: Value) -> Value {
    match forward_inner(&request).await {
        Ok(mut response) => {
            if let Some(map) = response.as_object_mut() {
                map.entry("id".to_string()).or_insert(id);
            }
            response
        }
        Err(error) => app_not_running_error(id, &error),
    }
}

fn app_not_running_error(id: Value, detail: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": -32002,
            "message": "KKTerm built-in MCP server is unavailable",
            "data": {
                "reason": "app_not_running",
                "detail": detail,
                "hint": "Start KKTerm.exe and ensure Settings > AI Assistant > Built-in MCP Server is enabled.",
            },
        },
    })
}

async fn forward_inner(request: &Value) -> Result<Value, String> {
    let info_path =
        bridge_info_path().ok_or_else(|| "could not resolve app data directory".to_string())?;
    let info = read_bridge_info(&info_path)
        .map_err(|e| format!("bridge info unavailable at {}: {e}", info_path.display()))?;

    let stream = open_pipe(&info.pipe_name).await?;
    let (reader, mut writer) = tokio::io::split(stream.into_inner());
    let mut reader = BufReader::new(reader);

    writer
        .write_all(info.token.as_bytes())
        .await
        .map_err(|e| format!("pipe write: {e}"))?;
    writer
        .write_all(b"\n")
        .await
        .map_err(|e| format!("pipe write: {e}"))?;
    writer
        .flush()
        .await
        .map_err(|e| format!("pipe flush: {e}"))?;

    let mut ack = String::new();
    timeout(CONNECT_TIMEOUT, reader.read_line(&mut ack))
        .await
        .map_err(|_| "auth ack timed out".to_string())?
        .map_err(|e| format!("auth ack: {e}"))?;
    if !ack.contains("\"ok\":true") {
        return Err(format!("auth rejected: {}", ack.trim()));
    }

    let mut body = serde_json::to_vec(request).map_err(|e| format!("serialize: {e}"))?;
    body.push(b'\n');
    writer
        .write_all(&body)
        .await
        .map_err(|e| format!("forward write: {e}"))?;
    writer.flush().await.map_err(|e| format!("flush: {e}"))?;

    let mut response = String::new();
    timeout(CALL_TIMEOUT, reader.read_line(&mut response))
        .await
        .map_err(|_| "tool call timed out".to_string())?
        .map_err(|e| format!("read response: {e}"))?;
    if response.trim().is_empty() {
        return Err("empty response from bridge".to_string());
    }
    serde_json::from_str(response.trim()).map_err(|e| format!("invalid bridge response: {e}"))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeInfo {
    #[allow(dead_code)]
    version: u32,
    pipe_name: String,
    token: String,
    #[allow(dead_code)]
    pid: u32,
}

fn bridge_info_path() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf));
    bridge_info_path_for(exe_dir.as_deref(), app_data_dir())
}

fn bridge_info_path_for(
    exe_dir: Option<&std::path::Path>,
    app_data_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(exe_dir) = exe_dir.as_ref()
        && exe_dir.join(PORTABLE_MARKER_FILENAME).is_file()
    {
        return Some(exe_dir.join("data").join(BRIDGE_INFO_FILENAME));
    }

    let mut base = app_data_dir?;
    base.push(BUNDLE_IDENTIFIER);
    base.push(BRIDGE_INFO_FILENAME);
    Some(base)
}

#[cfg(target_os = "windows")]
fn app_data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

#[cfg(target_os = "linux")]
fn app_data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("XDG_DATA_HOME") {
        return Some(PathBuf::from(dir));
    }
    let home = std::env::var_os("HOME")?;
    let mut path = PathBuf::from(home);
    path.push(".local");
    path.push("share");
    Some(path)
}

#[cfg(target_os = "macos")]
fn app_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let mut path = PathBuf::from(home);
    path.push("Library");
    path.push("Application Support");
    Some(path)
}

fn read_bridge_info(path: &std::path::Path) -> std::io::Result<BridgeInfo> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

#[cfg(target_os = "windows")]
async fn open_pipe(pipe_name: &str) -> Result<PipeStream, String> {
    use tokio::net::windows::named_pipe::ClientOptions;
    use tokio::time::sleep;

    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        match ClientOptions::new().open(pipe_name) {
            Ok(client) => return Ok(PipeStream(client)),
            Err(error) if error.raw_os_error() == Some(231) => {
                if std::time::Instant::now() >= deadline {
                    return Err("named pipe is busy".to_string());
                }
                sleep(Duration::from_millis(50)).await;
            }
            Err(error) => return Err(format!("named pipe open: {error}")),
        }
    }
}

// macOS and Linux reach the live app over a Unix domain socket whose path the
// bridge publishes in the descriptor's `pipeName` field. Retry briefly on
// NotFound/ConnectionRefused to cover the small window between the app
// publishing the descriptor and the socket becoming connectable.
#[cfg(unix)]
async fn open_pipe(socket_path: &str) -> Result<PipeStream, String> {
    use std::io::ErrorKind;
    use tokio::time::sleep;

    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    loop {
        match tokio::net::UnixStream::connect(socket_path).await {
            Ok(stream) => return Ok(PipeStream(stream)),
            Err(error)
                if matches!(
                    error.kind(),
                    ErrorKind::NotFound | ErrorKind::ConnectionRefused
                ) =>
            {
                if std::time::Instant::now() >= deadline {
                    return Err(format!("unix socket unavailable: {error}"));
                }
                sleep(Duration::from_millis(50)).await;
            }
            Err(error) => return Err(format!("unix socket connect: {error}")),
        }
    }
}

#[cfg(not(any(windows, unix)))]
async fn open_pipe(_pipe_name: &str) -> Result<PipeStream, String> {
    Err("kkterm built-in MCP server transport is unsupported on this platform".to_string())
}

#[cfg(target_os = "windows")]
struct PipeStream(tokio::net::windows::named_pipe::NamedPipeClient);

#[cfg(target_os = "windows")]
impl PipeStream {
    fn into_inner(self) -> tokio::net::windows::named_pipe::NamedPipeClient {
        self.0
    }
}

#[cfg(unix)]
struct PipeStream(tokio::net::UnixStream);

#[cfg(unix)]
impl PipeStream {
    fn into_inner(self) -> tokio::net::UnixStream {
        self.0
    }
}

#[cfg(not(any(windows, unix)))]
struct PipeStream;

#[cfg(not(any(windows, unix)))]
impl PipeStream {
    fn into_inner(self) -> tokio::io::Empty {
        tokio::io::empty()
    }
}

async fn write_line<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    value: &Value,
) -> std::io::Result<()> {
    let mut bytes = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    writer.flush().await
}

fn writeln_stderr(message: &str) -> std::io::Result<()> {
    use std::io::Write;
    let stderr = std::io::stderr();
    let mut handle = stderr.lock();
    writeln!(handle, "{message}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interactive_no_args_and_common_aliases_show_help() {
        assert_eq!(cli_action(&[], true), CliAction::Help);
        for alias in ["help", "-h", "--help", "-help", "-?", "/?", "/h", "/help"] {
            assert_eq!(cli_action(&[alias.to_string()], false), CliAction::Help);
        }
    }

    #[test]
    fn piped_no_args_and_explicit_mcp_start_the_server() {
        assert_eq!(cli_action(&[], false), CliAction::Serve);
        assert_eq!(cli_action(&["mcp".to_string()], true), CliAction::Serve);
        assert_eq!(cli_action(&["serve".to_string()], true), CliAction::Serve);
    }

    #[test]
    fn version_and_invalid_arguments_are_classified() {
        assert_eq!(
            cli_action(&["--version".to_string()], true),
            CliAction::Version
        );
        assert_eq!(
            cli_action(&["unexpected".to_string()], true),
            CliAction::Invalid("unexpected".to_string())
        );
    }

    #[test]
    fn portable_cli_resolves_only_its_sibling_bridge_descriptor() {
        let portable_root = tempfile::tempdir().expect("portable root");
        std::fs::write(portable_root.path().join(PORTABLE_MARKER_FILENAME), [])
            .expect("portable marker");
        let installed_root = PathBuf::from(r"C:\InstalledState");

        let path = bridge_info_path_for(Some(portable_root.path()), Some(installed_root))
            .expect("bridge info path");

        assert_eq!(
            path,
            portable_root.path().join("data").join(BRIDGE_INFO_FILENAME)
        );
    }

    #[test]
    fn installed_cli_preserves_the_existing_app_data_lookup() {
        let executable_root = tempfile::tempdir().expect("executable root");
        let installed_root = PathBuf::from(r"C:\InstalledState");

        let path = bridge_info_path_for(Some(executable_root.path()), Some(installed_root.clone()))
            .expect("bridge info path");

        assert_eq!(
            path,
            installed_root
                .join(BUNDLE_IDENTIFIER)
                .join(BRIDGE_INFO_FILENAME)
        );
    }

    #[tokio::test]
    async fn unknown_notifications_do_not_receive_responses() {
        let response = handle_request(json!({
            "jsonrpc": "2.0",
            "method": "notifications/cancelled",
            "params": {"requestId": 7}
        }))
        .await;

        assert!(response.is_none());
    }

    #[tokio::test]
    async fn initialize_rejects_unsupported_protocol_versions() {
        let response = handle_request(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"protocolVersion": "1900-01-01"}
        }))
        .await
        .expect("initialize response");

        assert_eq!(response["error"]["code"], -32602);
    }
}

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::OnceLock,
    sync::atomic::{AtomicBool, Ordering},
};

use serde_json::{Value, json};

static LOG_STATUS: OnceLock<String> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static LOG_DIRECTORY_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();
static ADVANCED_DEBUGGING_ENABLED: AtomicBool = AtomicBool::new(false);

pub fn init() {
    init_with_directory(None);
}

pub fn init_in_directory(log_dir: PathBuf) {
    let _ = LOG_DIRECTORY_OVERRIDE.set(log_dir.clone());
    init_with_directory(Some(log_dir));
}

fn init_with_directory(log_dir: Option<PathBuf>) {
    let status = match write_startup_line(log_dir.as_deref()) {
        Ok(path) => {
            let status = format!("Local logs: {}", path.display());
            let _ = LOG_PATH.set(path);
            status
        }
        Err(error) => format!("Local logging unavailable: {error}"),
    };

    let _ = LOG_STATUS.set(status);
}

pub fn log_path() -> Option<PathBuf> {
    LOG_PATH.get().cloned()
}

pub fn log_dir() -> Result<PathBuf, String> {
    if let Some(log_path) = LOG_PATH.get() {
        return log_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "failed to resolve log folder".to_string());
    }
    if let Some(log_dir) = LOG_DIRECTORY_OVERRIDE.get() {
        return Ok(log_dir.clone());
    }

    let exe_path = std::env::current_exe().ok();
    let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    runtime_log_dir_for(exe_path.as_deref(), local_app_data.as_deref())
        .ok_or_else(|| "failed to resolve log folder".to_string())
}

pub fn status() -> String {
    LOG_STATUS
        .get()
        .cloned()
        .unwrap_or_else(|| "Local logging pending".to_string())
}

pub fn ai_assistant_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH
        .get()
        .map(|path| ai_assistant_debug_log_path_for(path))
    else {
        return;
    };
    let line = format_ai_assistant_debug_log_entry(event, payload);
    if let Err(error) = append_ai_assistant_debug_line(&log_path, &line) {
        eprintln!("failed to write AI Assistant debug log: {error}");
    }
}

pub fn mcp_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH.get().map(|path| mcp_debug_log_path_for(path)) else {
        return;
    };
    let line = format_debug_log_entry(event, payload);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write MCP debug log: {error}");
    }
}

pub fn ui_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH.get().map(|path| ui_debug_log_path_for(path)) else {
        return;
    };
    let line = format_debug_log_entry(event, payload);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write UI debug log: {error}");
    }
}

pub fn url_connection_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH
        .get()
        .map(|path| url_connection_debug_log_path_for(path))
    else {
        return;
    };
    let line = format_debug_log_entry(event, payload);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write URL Connection debug log: {error}");
    }
}

pub fn rdp_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH.get().map(|path| rdp_debug_log_path_for(path)) else {
        return;
    };
    let redacted = redact_rdp_debug_payload(payload);
    let line = format_debug_log_entry(event, &redacted);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write RDP debug log: {error}");
    }
}

pub fn ssh_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH.get().map(|path| ssh_debug_log_path_for(path)) else {
        return;
    };
    let line = format_debug_log_entry(event, payload);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write SSH debug log: {error}");
    }
}

pub fn sftp_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH.get().map(|path| sftp_debug_log_path_for(path)) else {
        return;
    };
    let line = format_debug_log_entry(event, payload);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write SFTP debug log: {error}");
    }
}

pub fn telnet_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH.get().map(|path| telnet_debug_log_path_for(path)) else {
        return;
    };
    let line = format_debug_log_entry(event, payload);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write Telnet debug log: {error}");
    }
}

pub fn serial_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH.get().map(|path| serial_debug_log_path_for(path)) else {
        return;
    };
    let line = format_debug_log_entry(event, payload);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write Serial debug log: {error}");
    }
}

pub fn installer_helper_debug(event: &str, payload: &Value) {
    if !sensitive_debug_log_enabled(cfg!(debug_assertions), advanced_debugging_enabled()) {
        return;
    }
    let Some(log_path) = LOG_PATH
        .get()
        .map(|path| installer_helper_debug_log_path_for(path))
    else {
        return;
    };
    let line = format_debug_log_entry(event, payload);
    if let Err(error) = append_debug_line(&log_path, &line) {
        eprintln!("failed to write Install Helper debug log: {error}");
    }
}

pub fn set_advanced_debugging_enabled(enabled: bool) {
    let was_enabled = ADVANCED_DEBUGGING_ENABLED.swap(enabled, Ordering::Relaxed);
    if enabled && !was_enabled {
        write_advanced_debugging_enabled_markers();
    }
}

pub fn advanced_debugging_enabled() -> bool {
    ADVANCED_DEBUGGING_ENABLED.load(Ordering::Relaxed)
}

fn write_startup_line(override_dir: Option<&Path>) -> std::io::Result<PathBuf> {
    let log_dir = match override_dir {
        Some(path) => path.to_path_buf(),
        None => {
            let exe_path = std::env::current_exe().ok();
            let local_app_data = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
            runtime_log_dir_for(exe_path.as_deref(), local_app_data.as_deref())
                .ok_or_else(|| std::io::Error::other("failed to resolve log folder"))?
        }
    };
    fs::create_dir_all(&log_dir)?;

    let log_path = log_dir.join("kkterm.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;

    writeln!(file, "KKTerm runtime started")?;
    Ok(log_path)
}

fn sensitive_debug_log_enabled(debug_assertions: bool, advanced_debugging_enabled: bool) -> bool {
    debug_assertions || advanced_debugging_enabled
}

fn runtime_log_dir_for(exe_path: Option<&Path>, local_app_data: Option<&Path>) -> Option<PathBuf> {
    exe_path
        .and_then(Path::parent)
        .map(|folder| folder.join("Logs"))
        .or_else(|| local_app_data.map(|folder| folder.join("KKTerm").join("Logs")))
}

fn redact_rdp_debug_payload(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| {
                    if is_sensitive_rdp_debug_key(key) {
                        (key.clone(), Value::String("[redacted]".to_string()))
                    } else {
                        (key.clone(), redact_rdp_debug_payload(value))
                    }
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(redact_rdp_debug_payload).collect()),
        _ => value.clone(),
    }
}

fn is_sensitive_rdp_debug_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("token")
        || normalized.contains("credential")
        || normalized.contains("passphrase")
}

fn write_advanced_debugging_enabled_markers() {
    let Some(runtime_log_path) = LOG_PATH.get() else {
        return;
    };
    let line = format_debug_log_entry(
        "advanced_debugging.enabled",
        &json!({
            "debugBuild": cfg!(debug_assertions),
        }),
    );
    let log_paths = [
        ai_assistant_debug_log_path_for(runtime_log_path),
        mcp_debug_log_path_for(runtime_log_path),
        installer_helper_debug_log_path_for(runtime_log_path),
        ui_debug_log_path_for(runtime_log_path),
        url_connection_debug_log_path_for(runtime_log_path),
        rdp_debug_log_path_for(runtime_log_path),
        ssh_debug_log_path_for(runtime_log_path),
        sftp_debug_log_path_for(runtime_log_path),
        telnet_debug_log_path_for(runtime_log_path),
        serial_debug_log_path_for(runtime_log_path),
    ];
    for log_path in log_paths {
        if let Err(error) = append_debug_line(&log_path, &line) {
            eprintln!("failed to write advanced debugging marker: {error}");
        }
    }
}

fn ai_assistant_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("aiassistant.debug.log")
}

fn mcp_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("mcp.debug.log")
}

fn installer_helper_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("installer.helper.debug.log")
}

fn ui_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("ui.debug.log")
}

fn url_connection_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("url.connection.debug.log")
}

fn rdp_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("rdp.debug.log")
}

fn ssh_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("ssh.debug.log")
}

fn sftp_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("sftp.debug.log")
}

fn telnet_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("telnet.debug.log")
}

fn serial_debug_log_path_for(runtime_log_path: &Path) -> PathBuf {
    runtime_log_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("serial.debug.log")
}

fn format_ai_assistant_debug_log_entry(event: &str, payload: &Value) -> String {
    format_debug_log_entry(event, payload)
}

fn format_debug_log_entry(event: &str, payload: &Value) -> String {
    let timestamp = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| time::OffsetDateTime::now_utc().unix_timestamp().to_string());
    let line = json!({
        "timestamp": timestamp,
        "event": event,
        "payload": payload,
    });
    format!("{line}\n")
}

fn append_ai_assistant_debug_line(path: &Path, line: &str) -> std::io::Result<()> {
    append_debug_line(path, line)
}

fn append_debug_line(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(line.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn ai_assistant_debug_log_path_uses_runtime_log_directory() {
        let path = ai_assistant_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("aiassistant.debug.log"));
    }

    #[test]
    fn mcp_debug_log_path_uses_runtime_log_directory() {
        let path = mcp_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("mcp.debug.log"));
    }

    #[test]
    fn installer_helper_debug_log_path_uses_runtime_log_directory() {
        let path = installer_helper_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(
            path,
            PathBuf::from("logs").join("installer.helper.debug.log")
        );
    }

    #[test]
    fn ui_debug_log_path_uses_runtime_log_directory() {
        let path = ui_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("ui.debug.log"));
    }

    #[test]
    fn url_connection_debug_log_path_uses_runtime_log_directory() {
        let path = url_connection_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("url.connection.debug.log"));
    }

    #[test]
    fn rdp_debug_log_path_uses_runtime_log_directory() {
        let path = rdp_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("rdp.debug.log"));
    }

    #[test]
    fn ssh_debug_log_path_uses_runtime_log_directory() {
        let path = ssh_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("ssh.debug.log"));
    }

    #[test]
    fn sftp_debug_log_path_uses_runtime_log_directory() {
        let path = sftp_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("sftp.debug.log"));
    }

    #[test]
    fn telnet_debug_log_path_uses_runtime_log_directory() {
        let path = telnet_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("telnet.debug.log"));
    }

    #[test]
    fn serial_debug_log_path_uses_runtime_log_directory() {
        let path = serial_debug_log_path_for(Path::new("logs/kkterm.log"));

        assert_eq!(path, PathBuf::from("logs").join("serial.debug.log"));
    }

    #[test]
    fn runtime_log_dir_uses_executable_directory_with_spaces() {
        // Build paths from components so the test exercises the same
        // parent/join logic on Windows, macOS, and Linux.
        let exe_dir = PathBuf::from("Program Files").join("KK Term");
        let exe_path = exe_dir.join("kkterm.exe");

        let path = runtime_log_dir_for(Some(&exe_path), None).expect("log dir");

        assert_eq!(path, exe_dir.join("Logs"));
    }

    #[test]
    fn runtime_log_dir_falls_back_to_local_app_data() {
        let local_app_data = PathBuf::from("AppData").join("Local");

        let path = runtime_log_dir_for(None, Some(&local_app_data)).expect("log dir");

        assert_eq!(path, local_app_data.join("KKTerm").join("Logs"));
    }

    #[test]
    fn ai_assistant_debug_log_entry_is_json_line_with_raw_payload() {
        let line = format_ai_assistant_debug_log_entry(
            "tool.request",
            &json!({
                "toolName": "dashboard_create_widget",
                "arguments": {
                    "title": "Latency Trend",
                    "body": {
                        "source": "const chart = new uPlot(opts, data, root);"
                    }
                }
            }),
        );

        assert!(line.ends_with('\n'));
        let parsed: serde_json::Value =
            serde_json::from_str(line.trim_end()).expect("log entry should be valid JSON");
        assert_eq!(parsed["event"], "tool.request");
        assert_eq!(parsed["payload"]["toolName"], "dashboard_create_widget");
        assert_eq!(
            parsed["payload"]["arguments"]["body"]["source"],
            "const chart = new uPlot(opts, data, root);"
        );
        assert!(
            parsed["timestamp"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
    }

    #[test]
    fn sensitive_debug_logs_are_enabled_for_release_only_when_advanced_debugging_is_on() {
        assert!(sensitive_debug_log_enabled(true, false));
        assert!(sensitive_debug_log_enabled(true, true));
        assert!(!sensitive_debug_log_enabled(false, false));
        assert!(sensitive_debug_log_enabled(false, true));
    }

    #[test]
    fn advanced_debugging_marker_is_json_line() {
        let line = format_debug_log_entry(
            "advanced_debugging.enabled",
            &json!({
                "debugBuild": false,
            }),
        );

        let parsed: serde_json::Value =
            serde_json::from_str(line.trim_end()).expect("marker should be valid JSON");
        assert_eq!(parsed["event"], "advanced_debugging.enabled");
        assert_eq!(parsed["payload"]["debugBuild"], false);
    }

    #[test]
    fn rdp_debug_payload_redacts_secret_like_keys_recursively() {
        let redacted = redact_rdp_debug_payload(&json!({
            "host": "rdp.example",
            "dispatchSequence": 42,
            "password": "secret-password",
            "clearTextPassword": "clear-secret",
            "secretOwnerId": "connection-password-owner",
            "options": {
                "redirectClipboard": true,
                "api_token": "token-value",
                "nested": [
                    {
                        "passphrase": "phrase-value",
                        "username": "alice"
                    }
                ]
            }
        }));

        assert_eq!(redacted["host"], "rdp.example");
        assert_eq!(redacted["dispatchSequence"], 42);
        assert_eq!(redacted["password"], "[redacted]");
        assert_eq!(redacted["clearTextPassword"], "[redacted]");
        assert_eq!(redacted["secretOwnerId"], "[redacted]");
        assert_eq!(redacted["options"]["redirectClipboard"], true);
        assert_eq!(redacted["options"]["api_token"], "[redacted]");
        assert_eq!(redacted["options"]["nested"][0]["passphrase"], "[redacted]");
        assert_eq!(redacted["options"]["nested"][0]["username"], "alice");
    }
}

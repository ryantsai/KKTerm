use super::ai_interaction_debug;
#[allow(unused_imports)]
use super::*;

pub(crate) struct AcpCommandSpec {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
    pub(crate) label: &'static str,
}

pub(crate) struct AcpStdioSession {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    rx: mpsc::Receiver<String>,
    /// Polled between received lines (≤250ms latency). When it reports true
    /// the in-flight request aborts and `Drop` kills the CLI child process.
    /// Set only for interactive streaming runs so Stop cancels CLI-backed
    /// sessions the same way it cancels HTTP provider runs.
    cancel_probe: Option<Box<dyn Fn() -> bool>>,
}

impl AcpStdioSession {
    fn start(spec: &AcpCommandSpec) -> Result<Self, String> {
        ai_interaction_debug!(
            "agent.acp_start",
            json!({
                "label": spec.label,
                "program": &spec.program,
                "args": &spec.args,
            })
        );
        let mut child = Command::new(&spec.program);
        child
            .args(&spec.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::installer::proc::no_window(&mut child);
        let mut child = child.spawn().map_err(|error| {
            format!(
                "failed to start {} ACP backend with `{}`: {error}",
                spec.label, spec.program
            )
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("failed to open {} ACP stdin", spec.label))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("failed to open {} ACP stdout", spec.label))?;
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    ai_interaction_debug!("agent.acp_stderr", json!({ "line": line }));
                }
            });
        }
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let _ = tx.send(line);
            }
        });
        Ok(Self {
            child,
            stdin,
            rx,
            cancel_probe: None,
        })
    }

    fn request(
        &mut self,
        id: u64,
        method: &str,
        params: Value,
        timeout_duration: Duration,
        mut notification_handler: impl FnMut(&mut Self, Value) -> Result<(), String>,
    ) -> Result<Value, String> {
        self.write_json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))?;
        self.wait_for_id(id, timeout_duration, &mut notification_handler)
    }

    fn wait_for_id(
        &mut self,
        id: u64,
        timeout_duration: Duration,
        notification_handler: &mut impl FnMut(&mut Self, Value) -> Result<(), String>,
    ) -> Result<Value, String> {
        // Idle timeout: every received line proves the backend is alive, so the
        // deadline restarts after each processed message. Long agent turns that
        // keep streaming updates (or wait on an in-app permission answer) no
        // longer abort at a fixed wall-clock cutoff; only true silence times out.
        let mut deadline = Instant::now() + timeout_duration;
        while Instant::now() < deadline {
            if self.cancel_probe.as_ref().is_some_and(|probe| probe()) {
                return Err(ASSISTANT_STREAM_CANCELED_ERROR.to_string());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            let Ok(line) = self
                .rx
                .recv_timeout(remaining.min(Duration::from_millis(250)))
            else {
                continue;
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                // Tolerate stray non-JSON stdout lines (npm/npx notices, adapter
                // banners) instead of abandoning the whole session over one line.
                ai_interaction_debug!("agent.acp_recv_invalid", json!({ "line": line }));
                continue;
            };
            ai_interaction_debug!("agent.acp_recv", value.clone());
            if acp_message_is_response_for(&value, id) {
                if let Some(error) = value.get("error") {
                    return Err(format!("ACP backend returned an error: {error}"));
                }
                return value
                    .get("result")
                    .cloned()
                    .ok_or_else(|| "ACP backend response did not include result".to_string());
            }
            if value.get("method").is_some() {
                notification_handler(self, value)?;
            }
            deadline = Instant::now() + timeout_duration;
        }
        Err(format!("timed out waiting for ACP response id {id}"))
    }

    fn write_json(&mut self, value: Value) -> Result<(), String> {
        ai_interaction_debug!("agent.acp_send", value.clone());
        let line = serde_json::to_string(&value)
            .map_err(|error| format!("failed to serialize ACP JSON-RPC: {error}"))?;
        writeln!(self.stdin, "{line}")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| format!("failed to write ACP JSON-RPC: {error}"))
    }
}

impl Drop for AcpStdioSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A message is the response to KKTerm's request only when it carries no
/// `method`: agent-initiated requests and notifications always have one, and
/// their JSON-RPC ids live in the agent's own id namespace, which may collide
/// numerically with KKTerm's request ids.
pub(crate) fn acp_message_is_response_for(value: &Value, id: u64) -> bool {
    value.get("method").is_none() && value.get("id").and_then(Value::as_u64) == Some(id)
}

/// Why an ACP turn failed, plus whether `session/prompt` had already been
/// dispatched. Once the prompt starts, real agent work may have happened
/// (streamed text, kkterm MCP tool side effects), so callers must not re-run
/// the same turn through the one-shot CLI fallback.
pub(crate) struct AcpRunFailure {
    pub(crate) error: String,
    pub(crate) prompt_started: bool,
}

pub(crate) fn run_acp_agent_command(
    backend: AiCliBackendKind,
    cli_command: &str,
    model: &str,
    prompt: &str,
    app: &tauri::AppHandle,
    settings: &AiProviderSettings,
) -> Result<String, AcpRunFailure> {
    run_acp_agent_command_streaming(backend, cli_command, model, prompt, None, app, settings)
}

pub(crate) fn run_acp_agent_command_streaming(
    backend: AiCliBackendKind,
    cli_command: &str,
    model: &str,
    prompt: &str,
    channel: Option<&Channel<Value>>,
    app: &tauri::AppHandle,
    settings: &AiProviderSettings,
) -> Result<String, AcpRunFailure> {
    let mut prompt_started = false;
    run_acp_agent_turn(
        backend,
        cli_command,
        model,
        prompt,
        channel,
        app,
        settings,
        &mut prompt_started,
    )
    .map_err(|error| AcpRunFailure {
        error,
        prompt_started,
    })
}

fn run_acp_agent_turn(
    backend: AiCliBackendKind,
    cli_command: &str,
    model: &str,
    prompt: &str,
    channel: Option<&Channel<Value>>,
    app: &tauri::AppHandle,
    settings: &AiProviderSettings,
    prompt_started: &mut bool,
) -> Result<String, String> {
    let spec = acp_command_spec(backend, cli_command, model);
    let cwd = crate::app_paths::data_dir(app)?;
    fs::create_dir_all(&cwd)
        .map_err(|error| format!("failed to create ACP working directory: {error}"))?;
    let cwd = cwd
        .to_str()
        .ok_or_else(|| "ACP working directory is not valid UTF-8".to_string())?
        .to_string();
    let mut session = AcpStdioSession::start(&spec)?;
    if channel.is_some() {
        // Interactive run: let the user's Stop button cancel the CLI session.
        let probe_app = app.clone();
        let generation = assistant_stream_generation(app);
        session.cancel_probe = Some(Box::new(move || {
            assistant_stream_canceled(&probe_app, generation)
        }));
    }
    let mut content = String::new();
    session.request(
        1,
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": {},
            "clientInfo": {
                "name": "kkterm",
                "title": "KKTerm",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
        Duration::from_secs(30),
        |session, message| {
            handle_acp_backend_message(session, message, &mut content, channel, app, settings)
        },
    )?;
    let new_session = session.request(
        2,
        "session/new",
        json!({
            "cwd": cwd,
            "mcpServers": [acp_kkterm_mcp_server(&kkterm_cli_command_path()?)]
        }),
        Duration::from_secs(60),
        |session, message| {
            handle_acp_backend_message(session, message, &mut content, channel, app, settings)
        },
    )?;
    let session_id = new_session
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "ACP session/new response did not include sessionId".to_string())?
        .to_string();
    let prompt = format!("Requested model: {model}\n\n{prompt}");
    *prompt_started = true;
    session.request(
        3,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        }),
        COPILOT_SDK_RESPONSE_TIMEOUT,
        |session, message| {
            handle_acp_backend_message(session, message, &mut content, channel, app, settings)
        },
    )?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(format!(
            "{} ACP backend did not return assistant text",
            spec.label
        ));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn handle_acp_backend_message(
    session: &mut AcpStdioSession,
    message: Value,
    content: &mut String,
    channel: Option<&Channel<Value>>,
    app: &tauri::AppHandle,
    settings: &AiProviderSettings,
) -> Result<(), String> {
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    match method {
        "session/update" => {
            if let Some(delta) = acp_agent_message_delta_text(&message) {
                content.push_str(&delta);
                if let Some(channel) = channel {
                    emit_stream(channel, &AiStreamEvent::ContentDelta { delta })?;
                }
            } else if let Some(channel) = channel {
                if let Some(event) = acp_session_update_stream_event(&message) {
                    emit_stream(channel, &event)?;
                }
            }
        }
        "session/request_permission" => {
            if let Some(id) = acp_jsonrpc_id(&message) {
                let approved = acp_permission_approved(app, settings, &message);
                let outcome = acp_permission_selection(&message, approved);
                session.write_json(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "outcome": outcome
                    }
                }))?;
            }
        }
        _ => {
            // Reply method-not-found to any unknown agent request — numeric or
            // string id — so the CLI backend never hangs waiting on KKTerm.
            if let Some(id) = acp_jsonrpc_id(&message) {
                session.write_json(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32601,
                        "message": format!("KKTerm does not expose `{method}` to ACP CLI backends yet")
                    }
                }))?;
            }
        }
    }
    Ok(())
}

pub(crate) fn acp_jsonrpc_id(message: &Value) -> Option<Value> {
    match message.get("id") {
        Some(Value::Number(_)) | Some(Value::String(_)) => message.get("id").cloned(),
        _ => None,
    }
}

pub(crate) fn kkterm_cli_command_path() -> Result<String, String> {
    let exe_path = std::env::current_exe()
        .map_err(|error| format!("failed to resolve app executable path: {error}"))?;
    let exe_folder = exe_path
        .parent()
        .ok_or_else(|| "failed to resolve app executable folder".to_string())?;
    let cli_name = if cfg!(target_os = "windows") {
        "kkterm-cli.exe"
    } else {
        "kkterm-cli"
    };
    Ok(exe_folder.join(cli_name).to_string_lossy().into_owned())
}

pub(crate) fn acp_kkterm_mcp_server(command: &str) -> Value {
    json!({
        "type": "stdio",
        "name": "kkterm",
        "command": command,
        "args": [],
        "env": [],
    })
}

pub(crate) fn acp_permission_selection(message: &Value, approved: bool) -> Value {
    let desired_prefix = if approved { "allow" } else { "reject" };
    let selected_option = message
        .pointer("/params/options")
        .and_then(Value::as_array)
        .and_then(|options| {
            options.iter().find_map(|option| {
                let kind = option.get("kind").and_then(Value::as_str).unwrap_or("");
                let id = option.get("optionId").and_then(Value::as_str)?;
                if kind.starts_with(desired_prefix) {
                    Some(id.to_string())
                } else {
                    None
                }
            })
        });
    match selected_option {
        Some(option_id) => json!({
            "outcome": "selected",
            "optionId": option_id,
        }),
        None => json!({
            "outcome": "cancelled",
        }),
    }
}

pub(crate) fn acp_permission_approved(
    app: &tauri::AppHandle,
    settings: &AiProviderSettings,
    message: &Value,
) -> bool {
    if settings.tool_permission_mode() == "allowAll" {
        return true;
    }
    let tool_name = acp_permission_tool_name(message);
    let args = message
        .pointer("/params/toolCall")
        .cloned()
        .unwrap_or(Value::Null);
    // ACP tool calls carry CLI-defined shapes we can't classify, so no risk
    // notes here; session-allow behavior is unchanged for ACP.
    match app.try_state::<AssistantToolApprovalBridge>() {
        Some(bridge) => tauri::async_runtime::block_on(bridge.request(app, &tool_name, &args, &[])),
        None => false,
    }
}

pub(crate) fn acp_permission_tool_name(message: &Value) -> String {
    message
        .pointer("/params/toolCall/title")
        .and_then(Value::as_str)
        .or_else(|| {
            message
                .pointer("/params/toolCall/name")
                .and_then(Value::as_str)
        })
        .or_else(|| {
            message
                .pointer("/params/toolCall/toolName")
                .and_then(Value::as_str)
        })
        .unwrap_or("acp_tool_call")
        .trim_start_matches("Call ")
        .to_string()
}

#[cfg(test)]
pub(crate) fn acp_permission_rejection(message: &Value) -> Value {
    acp_permission_selection(message, false)
}

pub(crate) fn acp_agent_message_delta_text(message: &Value) -> Option<String> {
    let update = message.pointer("/params/update")?;
    let kind = update.get("sessionUpdate").and_then(Value::as_str)?;
    if kind != "agent_message_chunk" {
        return None;
    }
    acp_content_text(update.get("content")?)
}

/// Maps non-content ACP `session/update` notifications onto the stream-event
/// vocabulary the Assistant work panel already renders: thought chunks become
/// reasoning deltas, tool-call lifecycle updates become tool chips, and agent
/// plans become the work-plan step list.
pub(crate) fn acp_session_update_stream_event(message: &Value) -> Option<AiStreamEvent> {
    let update = message.pointer("/params/update")?;
    let kind = update.get("sessionUpdate").and_then(Value::as_str)?;
    match kind {
        "agent_thought_chunk" => acp_content_text(update.get("content")?)
            .map(|delta| AiStreamEvent::ReasoningDelta { delta }),
        "tool_call" | "tool_call_update" => {
            let tool_id = update
                .get("toolCallId")
                .and_then(Value::as_str)?
                .to_string();
            let tool_name = update
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            let status = update
                .get("status")
                .and_then(Value::as_str)
                // A fresh `tool_call` without a status starts pending per ACP;
                // a status-less `tool_call_update` changes nothing chip-worthy.
                .unwrap_or(if kind == "tool_call" { "pending" } else { "" });
            match status {
                "completed" => Some(AiStreamEvent::ToolCallEnd {
                    tool_id,
                    tool_name,
                    error: None,
                }),
                "failed" => Some(AiStreamEvent::ToolCallEnd {
                    tool_id,
                    tool_name,
                    error: Some("failed".to_string()),
                }),
                "pending" | "in_progress" if !tool_name.is_empty() => {
                    Some(AiStreamEvent::ToolCallStart { tool_id, tool_name })
                }
                _ => None,
            }
        }
        "plan" => {
            let entries = update.get("entries").and_then(Value::as_array)?;
            let steps = entries
                .iter()
                .enumerate()
                .filter_map(|(index, entry)| {
                    let label = entry.get("content").and_then(Value::as_str)?.trim();
                    if label.is_empty() {
                        return None;
                    }
                    let status = match entry.get("status").and_then(Value::as_str) {
                        Some("in_progress") => "running",
                        Some("completed") => "completed",
                        _ => "pending",
                    };
                    Some(AssistantPlanStep {
                        id: format!("acp-plan-{index}"),
                        label: label.to_string(),
                        status: status.to_string(),
                        detail: None,
                    })
                })
                .collect::<Vec<_>>();
            if steps.is_empty() {
                None
            } else {
                Some(AiStreamEvent::PlanUpdate { goal: None, steps })
            }
        }
        _ => None,
    }
}

pub(crate) fn acp_content_text(content: &Value) -> Option<String> {
    if content.get("type").and_then(Value::as_str) == Some("text") {
        return content
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    None
}

pub(crate) fn acp_command_spec(
    backend: AiCliBackendKind,
    cli_command: &str,
    model: &str,
) -> AcpCommandSpec {
    match backend {
        AiCliBackendKind::Codex => AcpCommandSpec {
            program: npx_command(),
            args: vec![
                "-y".to_string(),
                "@zed-industries/codex-acp@0.15.0".to_string(),
            ],
            label: "Codex ACP",
        },
        AiCliBackendKind::ClaudeCode => AcpCommandSpec {
            program: npx_command(),
            args: vec![
                "-y".to_string(),
                "@agentclientprotocol/claude-agent-acp@0.40.0".to_string(),
            ],
            label: "Claude ACP",
        },
        // Cursor ships a native ACP stdio server (`agent acp` / `cursor-agent acp`).
        AiCliBackendKind::Cursor => {
            let mut args = Vec::new();
            if !model.is_empty() && model != "default" && model != "auto" {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            args.push("acp".to_string());
            AcpCommandSpec {
                program: cli_command.to_string(),
                args,
                label: "Cursor ACP",
            }
        }
    }
}

pub(crate) fn npx_command() -> String {
    if cfg!(target_os = "windows") {
        "npx.cmd".to_string()
    } else {
        "npx".to_string()
    }
}

pub async fn ai_cli_backend_status(
    provider: AiCliBackendKind,
    configured_path: Option<String>,
) -> AiCliBackendStatus {
    let command = resolve_cli_backend_command(provider, configured_path);
    let command_for_worker = command.clone();
    tauri::async_runtime::spawn_blocking(move || cli_backend_status(provider, command_for_worker))
        .await
        .unwrap_or_else(|error| AiCliBackendStatus {
            provider,
            command,
            installed: false,
            authenticated: false,
            version: None,
            error: Some(format!("failed to check CLI status: {error}")),
        })
}

pub fn open_ai_cli_backend_auth(
    provider: AiCliBackendKind,
    configured_path: Option<String>,
) -> Result<(), String> {
    let command = resolve_cli_backend_command(provider, configured_path);
    let auth_command = match provider {
        AiCliBackendKind::Codex => format!("{} login", shell_quote(&command)),
        AiCliBackendKind::ClaudeCode => format!("{} auth login", shell_quote(&command)),
        AiCliBackendKind::Cursor => format!("{} login", shell_quote(&command)),
    };
    spawn_external_terminal(&auth_command)
}

pub(crate) fn default_cli_command(provider: AiCliBackendKind) -> &'static str {
    match provider {
        AiCliBackendKind::Codex => "codex",
        AiCliBackendKind::ClaudeCode => "claude",
        // The ACP registry uses `cursor-agent`; current Cursor releases also
        // expose `agent`, which discovery accepts as a fallback.
        AiCliBackendKind::Cursor => "cursor-agent",
    }
}

pub(crate) fn resolve_cli_backend_command(
    provider: AiCliBackendKind,
    configured: Option<String>,
) -> String {
    if let Some(path) = configured
        .map(|value| normalize_configured_cli_command(&value))
        .filter(|value| !value.is_empty())
    {
        return path;
    }

    common_cli_backend_command_path(provider)
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| default_cli_command(provider).to_string())
}

pub(crate) fn normalize_configured_cli_command(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

pub(crate) fn common_cli_backend_command_path(provider: AiCliBackendKind) -> Option<PathBuf> {
    cli_backend_discovery_candidates(provider)
        .into_iter()
        .find(|path| path.is_file())
}

pub(crate) fn cli_backend_discovery_candidates(provider: AiCliBackendKind) -> Vec<PathBuf> {
    combine_cli_backend_candidates(
        path_cli_backend_candidates(provider),
        common_user_bin_candidates(cli_backend_command_names(provider)),
        match provider {
            AiCliBackendKind::Codex => codex_vscode_extension_candidates(),
            AiCliBackendKind::ClaudeCode | AiCliBackendKind::Cursor => Vec::new(),
        },
    )
}

pub(crate) fn combine_cli_backend_candidates(
    path_candidates: Vec<PathBuf>,
    common_candidates: Vec<PathBuf>,
    extension_candidates: Vec<PathBuf>,
) -> Vec<PathBuf> {
    path_candidates
        .into_iter()
        .chain(common_candidates)
        .chain(extension_candidates)
        .collect()
}

pub(crate) fn cli_backend_command_names(provider: AiCliBackendKind) -> &'static [&'static str] {
    match provider {
        #[cfg(target_os = "windows")]
        AiCliBackendKind::Codex => &["codex.exe", "codex.cmd"],
        #[cfg(not(target_os = "windows"))]
        AiCliBackendKind::Codex => &["codex"],
        #[cfg(target_os = "windows")]
        AiCliBackendKind::ClaudeCode => &["claude.exe", "claude.cmd"],
        #[cfg(not(target_os = "windows"))]
        AiCliBackendKind::ClaudeCode => &["claude"],
        // Cursor's installer exposes both names; prefer the product-specific
        // alias before the generic `agent` command.
        #[cfg(target_os = "windows")]
        AiCliBackendKind::Cursor => &[
            "cursor-agent.exe",
            "cursor-agent.cmd",
            "agent.exe",
            "agent.cmd",
        ],
        #[cfg(not(target_os = "windows"))]
        AiCliBackendKind::Cursor => &["cursor-agent", "agent"],
    }
}

pub(crate) fn common_user_bin_candidates(names: &[&str]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(profile) = std::env::var_os("USERPROFILE") {
        roots.push(PathBuf::from(&profile).join(".local").join("bin"));
    }
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join(".local").join("bin"));
    }
    if let Some(nvm_symlink) = std::env::var_os("NVM_SYMLINK") {
        roots.push(PathBuf::from(nvm_symlink));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(PathBuf::from(appdata).join("npm"));
    }

    bin_candidates_from_roots(roots, names)
}

pub(crate) fn path_cli_backend_candidates(provider: AiCliBackendKind) -> Vec<PathBuf> {
    let paths = [
        std::env::var_os("PATH"),
        crate::installer::install::refreshed_path_public().map(Into::into),
    ];
    let roots = paths
        .into_iter()
        .flatten()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .collect();
    bin_candidates_from_roots(roots, cli_backend_command_names(provider))
}

pub(crate) fn bin_candidates_from_roots(roots: Vec<PathBuf>, names: &[&str]) -> Vec<PathBuf> {
    roots
        .into_iter()
        .flat_map(|root| names.iter().map(move |name| root.join(name)))
        .collect()
}

pub(crate) fn codex_vscode_extension_candidates() -> Vec<PathBuf> {
    let Some(profile) = std::env::var_os("USERPROFILE") else {
        return Vec::new();
    };
    let extensions = PathBuf::from(profile).join(".vscode").join("extensions");
    let Ok(entries) = std::fs::read_dir(extensions) else {
        return Vec::new();
    };
    let mut extension_dirs = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(OsStr::to_str)
                .is_some_and(|name| name.starts_with("openai.chatgpt-"))
        })
        .collect::<Vec<_>>();
    extension_dirs.sort();
    extension_dirs.reverse();
    extension_dirs
        .into_iter()
        .flat_map(|path| {
            codex_extension_arch_dirs()
                .iter()
                .map(move |arch| path.join("bin").join(arch).join("codex.exe"))
        })
        .collect()
}

pub(crate) fn codex_extension_arch_dirs() -> &'static [&'static str] {
    #[cfg(target_arch = "aarch64")]
    {
        &["windows-arm64", "windows-x86_64"]
    }
    #[cfg(not(target_arch = "aarch64"))]
    {
        &["windows-x86_64", "windows-arm64"]
    }
}

pub(crate) fn cli_backend_status(
    provider: AiCliBackendKind,
    command: String,
) -> AiCliBackendStatus {
    let version_result = run_cli_capture(&command, &["--version"], None);
    let (installed, version, mut error) = match version_result {
        Ok(output) => (
            true,
            Some(output.trim().to_string()).filter(|v| !v.is_empty()),
            None,
        ),
        Err(message) => (false, None, Some(message)),
    };
    let authenticated = if installed {
        match provider {
            AiCliBackendKind::Codex => run_cli_capture(
                &command,
                &[
                    CODEX_CLI_APPROVAL_FLAG,
                    CODEX_CLI_APPROVAL_NEVER,
                    "exec",
                    CODEX_CLI_IGNORE_USER_CONFIG_FLAG,
                    "--ephemeral",
                    "--sandbox",
                    "read-only",
                    "--skip-git-repo-check",
                    "Reply with exactly OK.",
                ],
                Some(Duration::from_secs(45)),
            )
            .map(|output| output.contains("OK"))
            .unwrap_or_else(|message| {
                error = Some(message);
                false
            }),
            AiCliBackendKind::ClaudeCode => {
                run_cli_capture(&command, &["auth", "status"], Some(Duration::from_secs(20)))
                    .map(|output| claude_auth_status_logged_in(&output))
                    .unwrap_or_else(|message| {
                        error = Some(message);
                        false
                    })
            }
            // Cursor documents `status` as its authentication probe.
            AiCliBackendKind::Cursor => {
                run_cli_capture(&command, &["status"], Some(Duration::from_secs(20)))
                    .map(|output| cursor_auth_status_logged_in(&output))
                    .unwrap_or_else(|message| {
                        error = Some(message);
                        false
                    })
            }
        }
    } else {
        false
    };
    AiCliBackendStatus {
        provider,
        command,
        installed,
        authenticated,
        version,
        error,
    }
}

/// `claude auth status` can exit 0 while logged out, reporting
/// `"loggedIn": false` in its default JSON output — exit code alone is not an
/// authentication signal. Non-JSON output falls back to exit-code success so a
/// future CLI format change degrades to the old behavior instead of breaking.
pub(crate) fn claude_auth_status_logged_in(output: &str) -> bool {
    match serde_json::from_str::<Value>(output.trim()) {
        Ok(value) => value
            .get("loggedIn")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        Err(_) => true,
    }
}

/// `cursor-agent status` / `agent status` output is not a stable machine schema.
/// Treat clear "not logged in" phrases as unauthenticated; otherwise accept a
/// successful status probe, matching Cursor's documented status command.
pub(crate) fn cursor_auth_status_logged_in(output: &str) -> bool {
    let lower = output.to_lowercase();
    !(lower.contains("not logged")
        || lower.contains("not authenticated")
        || lower.contains("not signed in")
        || lower.contains("logged out")
        || lower.contains("unauthenticated")
        || (lower.contains("please run") && lower.contains("login"))
        || lower.contains("authentication required"))
}

pub(crate) fn run_cli_agent_command(
    backend: AiCliBackendKind,
    command: &str,
    model: &str,
    prompt: &str,
    cancel_probe: Option<&dyn Fn() -> bool>,
) -> Result<String, String> {
    let invocation = cli_agent_invocation(backend, model, prompt);
    ai_interaction_debug!(
        "agent.cli_oneshot_start",
        json!({
            "backend": backend,
            "command": command,
            "model": model,
            "promptBytes": prompt.len(),
            "promptChars": prompt.chars().count(),
            "promptDelivery": invocation.prompt_delivery,
            "argCount": invocation.args.len(),
        })
    );
    let arg_refs = invocation
        .args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let output_result = run_cli_capture_with_stdin_and_cancel(
        command,
        &arg_refs,
        invocation.stdin.as_deref(),
        Some(COPILOT_SDK_RESPONSE_TIMEOUT),
        cancel_probe,
    );
    match &output_result {
        Ok(output) => ai_interaction_debug!(
            "agent.cli_oneshot_done",
            json!({
                "backend": backend,
                "model": model,
                "outputBytes": output.len(),
                "outputChars": output.chars().count(),
            })
        ),
        Err(error) => ai_interaction_debug!(
            "agent.cli_oneshot_error",
            json!({
                "backend": backend,
                "model": model,
                "error": error,
            })
        ),
    }
    let output = output_result?;
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Err(format!(
            "{} did not return assistant text",
            match backend {
                AiCliBackendKind::Codex => "Codex CLI",
                AiCliBackendKind::ClaudeCode => "Claude Code CLI",
                AiCliBackendKind::Cursor => "Cursor Agent CLI",
            }
        ));
    }
    Ok(trimmed.to_string())
}

pub(crate) struct CliAgentInvocation {
    pub(crate) args: Vec<String>,
    pub(crate) stdin: Option<String>,
    pub(crate) prompt_delivery: &'static str,
}

pub(crate) fn cli_agent_invocation(
    backend: AiCliBackendKind,
    model: &str,
    prompt: &str,
) -> CliAgentInvocation {
    match backend {
        AiCliBackendKind::Codex => CliAgentInvocation {
            args: vec![
                CODEX_CLI_APPROVAL_FLAG.to_string(),
                CODEX_CLI_APPROVAL_NEVER.to_string(),
                "exec".to_string(),
                CODEX_CLI_IGNORE_USER_CONFIG_FLAG.to_string(),
                "--ephemeral".to_string(),
                "--sandbox".to_string(),
                "read-only".to_string(),
                "--skip-git-repo-check".to_string(),
                "--model".to_string(),
                model.to_string(),
                prompt.to_string(),
            ],
            stdin: None,
            prompt_delivery: "argv",
        },
        AiCliBackendKind::ClaudeCode => CliAgentInvocation {
            args: vec![
                "-p".to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "--tools".to_string(),
                String::new(),
                "--permission-mode".to_string(),
                "plan".to_string(),
                "--no-session-persistence".to_string(),
                "--model".to_string(),
                model.to_string(),
                "Respond to the KKTerm assistant request provided on stdin.".to_string(),
            ],
            stdin: Some(prompt.to_string()),
            prompt_delivery: "stdin",
        },
        // Keep the setup-failure fallback read-only. Cursor's Ask mode enforces
        // a read-only sandbox even when broader execution permissions are set.
        // Do not pass `-` as an argv sentinel (Cursor treats it as the prompt).
        AiCliBackendKind::Cursor => {
            let mut args = vec![
                "--print".to_string(),
                "--output-format".to_string(),
                "text".to_string(),
                "--mode=ask".to_string(),
            ];
            if !model.is_empty() && model != "default" && model != "auto" {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            CliAgentInvocation {
                args,
                stdin: Some(prompt.to_string()),
                prompt_delivery: "stdin",
            }
        }
    }
}

pub(crate) fn run_cli_capture(
    command: &str,
    args: &[&str],
    timeout: Option<Duration>,
) -> Result<String, String> {
    run_cli_capture_with_stdin(command, args, None, timeout)
}

pub(crate) fn run_cli_capture_with_stdin(
    command: &str,
    args: &[&str],
    stdin: Option<&str>,
    timeout: Option<Duration>,
) -> Result<String, String> {
    run_cli_capture_with_stdin_and_cancel(command, args, stdin, timeout, None)
}

pub(crate) fn run_cli_capture_with_stdin_and_cancel(
    command: &str,
    args: &[&str],
    stdin: Option<&str>,
    timeout: Option<Duration>,
    cancel_probe: Option<&dyn Fn() -> bool>,
) -> Result<String, String> {
    let (program, process_args) = cli_process_invocation(command, args);
    let mut cmd = Command::new(&program);
    cmd.args(&process_args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::installer::proc::no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("failed to start `{command}`: {error}"))?;
    if let Some(input) = stdin {
        let Some(mut child_stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("failed to open `{command}` stdin"));
        };
        if let Err(error) = child_stdin
            .write_all(input.as_bytes())
            .and_then(|_| child_stdin.flush())
        {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("failed to write `{command}` stdin: {error}"));
        }
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("failed to open `{command}` stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("failed to open `{command}` stderr"))?;
    let stdout_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::Read::read_to_end(&mut BufReader::new(stdout), &mut bytes);
        bytes
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = std::io::Read::read_to_end(&mut BufReader::new(stderr), &mut bytes);
        bytes
    });
    let started = Instant::now();
    let status = loop {
        if cancel_probe.is_some_and(|probe| probe()) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(ASSISTANT_STREAM_CANCELED_ERROR.to_string());
        }
        if timeout.is_some_and(|limit| started.elapsed() >= limit) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(format!("`{command}` timed out"));
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to wait for `{command}`: {error}"))?
        {
            break status;
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let stdout = String::from_utf8_lossy(&stdout_reader.join().unwrap_or_default()).to_string();
    let stderr = String::from_utf8_lossy(&stderr_reader.join().unwrap_or_default()).to_string();
    if !status.success() {
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(format!(
            "`{command}` exited with {}{}",
            status,
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {}", truncate_error_body(&detail))
            }
        ));
    }
    if stdout.trim().is_empty() {
        Ok(stderr)
    } else {
        Ok(stdout)
    }
}

/// One-shot CLI fallback is only for ACP setup failures (adapter missing,
/// initialize/session-new errors). Never fall back after `session/prompt`
/// started — the agent may already have streamed text or executed kkterm MCP
/// tools, and re-running the turn would duplicate both — and never fall back
/// on user cancellation.
pub(crate) fn should_fallback_from_acp_error(failure: &AcpRunFailure) -> bool {
    !failure.prompt_started && failure.error != ASSISTANT_STREAM_CANCELED_ERROR
}

pub(crate) fn cli_process_invocation(command: &str, args: &[&str]) -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        let lower = command.to_ascii_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            let mut process_args = vec!["/D".to_string(), "/C".to_string(), command.to_string()];
            process_args.extend(args.iter().map(|arg| (*arg).to_string()));
            return ("cmd.exe".to_string(), process_args);
        }
    }

    (
        command.to_string(),
        args.iter().map(|arg| (*arg).to_string()).collect(),
    )
}

pub(crate) fn spawn_external_terminal(command: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd.exe");
        // `command` is already shell-quoted (the CLI path is wrapped in double
        // quotes). Passing it through Rust's normal arg API escapes those quotes
        // to `\"`, which cmd.exe's `/K` parser does not understand, so the launch
        // fails with `'\"...claude.cmd\"' is not recognized`. `raw_arg` appends the
        // command line verbatim instead, letting us control quoting exactly.
        cmd.raw_arg(windows_external_terminal_command_line(command));
        cmd.spawn()
            .map_err(|error| format!("failed to open external terminal: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("sh");
        cmd.args(["-lc", command]);
        cmd.spawn()
            .map_err(|error| format!("failed to start CLI auth command: {error}"))?;
        Ok(())
    }
}

/// Builds the verbatim `cmd.exe` command line that opens a titled console window
/// and runs `command` in it, keeping the window open afterwards (`/K`).
///
/// `command` arrives already shell-quoted. Wrapping it in an extra pair of quotes
/// makes the inner `cmd /K` apply its quote-stripping rule (strip the outermost
/// pair), reconstructing the original quoted command — and this stays correct even
/// when the CLI path contains spaces.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn windows_external_terminal_command_line(command: &str) -> String {
    format!("/C start \"KKTerm AI CLI Auth\" cmd.exe /K \"{command}\"")
}

pub(crate) fn shell_quote(value: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

pub(crate) fn build_cli_agent_prompt(
    provider_kind: &str,
    settings: &AiProviderSettings,
    request: AgentRunRequest,
) -> Result<String, String> {
    build_cli_agent_prompt_with_usage(provider_kind, settings, request).map(|built| built.prompt)
}

pub(crate) struct CliAgentPrompt {
    pub(crate) prompt: String,
    pub(crate) usage: AgentContextUsage,
}

pub(crate) fn build_cli_agent_prompt_with_usage(
    provider_kind: &str,
    settings: &AiProviderSettings,
    request: AgentRunRequest,
) -> Result<CliAgentPrompt, String> {
    let prompt = trim_required("assistant prompt", request.prompt)?;
    let context_label = trim_required("assistant context", request.context_label)?;
    let mut out = String::new();
    if request.isolated_host_ai {
        out.push_str("You are a text-generation provider for a sandboxed application. Follow only the supplied system instruction, conversation history, and user request. Do not assume access to host product context, tools, memories, or live application state.\n\n");
    } else {
        out.push_str("You are KKTerm's AI Assistant for local-first administration workflows. ");
        out.push_str("Answer concisely. Do not claim to have used KKTerm tools or observed live state unless it appears in the context. ");
        out.push_str("When this turn is running through ACP, KKTerm tools are available through the attached kkterm MCP server. Use kkterm.workspace.connections.create/update/rename/move/delete to manage saved Connections, kkterm.workspace.connection_folders.create/rename/move/delete to organize folders, kkterm.workspace.connections.open to open saved Connections, and the other kkterm tools when they fit the user's request. Connection tools do not accept passwords or other secrets. If ACP is unavailable and the backend falls back to a one-shot CLI command, suggest commands or Connection details for user review instead of claiming that tools ran.\n\n");
    }
    if let Some(custom) =
        normalize_custom_instructions(Some(settings.custom_instructions().to_string()))
    {
        out.push_str(&custom);
        out.push_str("\n\n");
    }
    if let Some(language) = normalize_output_language(request.output_language) {
        out.push_str(&language);
        out.push_str("\n\n");
    }
    if !request.isolated_host_ai {
        out.push_str(&format!(
            "Active context: {context_label}\nAssistant intent: {}\nReasoning effort: {}\n\n",
            normalize_agent_intent(request.intent).as_str(),
            settings.reasoning_effort()
        ));
    }
    let non_history_chars = out.chars().count()
        + prompt.chars().count()
        + request
            .system_context
            .as_deref()
            .map(|context| truncated_prompt_section_char_count(context, 12_000))
            .unwrap_or(0)
        + request
            .selected_output
            .as_deref()
            .map(|output| truncated_prompt_section_char_count(output, 16_000))
            .unwrap_or(0)
        + request
            .page_context
            .as_ref()
            .map(|context| {
                context.source_label.chars().count()
                    + truncated_prompt_section_char_count(&context.text, 12_000)
            })
            .unwrap_or(0);
    let history = compact_agent_history(
        provider_kind,
        settings.model(),
        request.messages,
        non_history_chars,
    );
    let usage = history.context_usage(provider_kind, settings.model());
    if !history.messages.is_empty() {
        if history.omitted_messages > 0 {
            out.push_str(&history.compaction_notice());
            out.push_str("\n\n");
        }
        out.push_str("Recent chat history:\n");
        for message in history.messages {
            let role = message.role.trim();
            let content = message.content.trim();
            if !role.is_empty() && !content.is_empty() {
                out.push_str(role);
                out.push_str(": ");
                out.push_str(content);
                out.push('\n');
            }
        }
        out.push('\n');
    }
    if let Some(system_context) = request
        .system_context
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        out.push_str(if request.isolated_host_ai {
            "System instruction:\n"
        } else {
            "SSH target system context:\n```text\n"
        });
        out.push_str(&truncate_prompt_section(&system_context, 12_000));
        out.push_str(if request.isolated_host_ai {
            "\n\n"
        } else {
            "\n```\n\n"
        });
    }
    if let Some(selected_output) = request
        .selected_output
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        out.push_str("Selected terminal output:\n```text\n");
        out.push_str(&truncate_prompt_section(&selected_output, 16_000));
        out.push_str("\n```\n\n");
    }
    if let Some(page_context) = normalize_page_context(request.page_context) {
        out.push_str("Active page context: ");
        out.push_str(&page_context.source_label);
        out.push_str("\n```text\n");
        out.push_str(&truncate_prompt_section(&page_context.text, 12_000));
        out.push_str("\n```\n\n");
    }
    if !request.files.is_empty() || request.screenshot.is_some() || !request.screenshots.is_empty()
    {
        out.push_str("Note: file and screenshot attachments are not passed to the CLI backend in this version.\n\n");
    }
    out.push_str("User request:\n");
    out.push_str(&prompt);
    Ok(CliAgentPrompt { prompt: out, usage })
}

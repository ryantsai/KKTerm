// IT Ops Batch Run executor (docs/ITOPS.md Phase 2). A bounded-concurrency
// worker pool fans a Batch Task out across a resolved Site, streaming
// per-host progress and assembling a consolidated report. The transport is
// abstracted behind `BatchTransport` so the SSH adapter here (Phase 2) and the
// WinRM/PsExec adapters (Phase 6) share the exact same runner and UI.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, mpsc};
use std::time::Instant;

use base64::Engine;
use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};
use tauri::AppHandle;
use winrm_rs::{WinrmClient, WinrmConfig, WinrmCredentials};

use crate::secrets;
use crate::ssh::{self, NativeSshAuth, NativeSshCommandRequest};

use super::types::{
    BatchTask, ExecOutcome, HostReport, PlaybookStepKind, ResolvedHost, RunEvent, RunReport,
    Transport, WindowsExecutionContext,
};

pub const DEFAULT_CONCURRENCY: usize = 8;
pub const DEFAULT_TIMEOUT_SECONDS: u64 = 120;

/// Upper bound on per-host output persisted in a saved Run Report, so a chatty
/// command on a large site cannot bloat the history row. The live stream is
/// uncapped; only the stored report is trimmed.
const MAX_STORED_OUTPUT: usize = 256 * 1024;

/// Trim `output` to `MAX_STORED_OUTPUT` on a char boundary, appending a marker
/// when truncated. Used only for the persisted report row.
pub fn cap_output(mut output: String) -> String {
    if output.len() <= MAX_STORED_OUTPUT {
        return output;
    }
    let mut end = MAX_STORED_OUTPUT;
    while end > 0 && !output.is_char_boundary(end) {
        end -= 1;
    }
    output.truncate(end);
    output.push_str("\n…[output truncated]");
    output
}

/// Placeholder substituted for any sudo secret that surfaces in playbook output.
const REDACTED_SECRET: &str = "••••••";

/// Scrub every `secret` occurrence out of `text`. A PTY with echo enabled reflects
/// the password we push for a `sudo -S` prompt, so this is the last line of defense
/// enforcing the ITOPS invariant that plaintext never reaches the live stream or a
/// persisted Run History row (docs/ITOPS.md). Empty secrets are ignored so an
/// unset credential can never blank the whole transcript.
pub fn redact_secrets(text: &str, secrets: &[String]) -> String {
    let mut redacted = text.to_string();
    for secret in secrets {
        if secret.is_empty() {
            continue;
        }
        if redacted.contains(secret.as_str()) {
            redacted = redacted.replace(secret.as_str(), REDACTED_SECRET);
        }
    }
    redacted
}

/// Runs a Batch Task on one host. Blocking; called from worker threads.
/// `on_chunk` is invoked for each output frame as it arrives so the runner can
/// stream live per-host output; the final combined output is still returned in
/// the `ExecOutcome`.
pub trait BatchTransport: Send + Sync {
    fn exec(
        &self,
        host: &ResolvedHost,
        task: &BatchTask,
        on_chunk: &(dyn Fn(&str) + Send + Sync),
    ) -> ExecOutcome;
}

/// Fan a Batch Task out across `hosts` with at most `concurrency` in flight,
/// emitting `HostStarted`/`HostFinished` per host and returning the consolidated
/// `RunReport`. When `cancel` is set, workers stop picking up new hosts (already
/// in-flight hosts finish); un-started hosts are simply absent from the report.
pub fn run_batch(
    run_id: &str,
    hosts: &[ResolvedHost],
    task: &BatchTask,
    transport: &dyn BatchTransport,
    concurrency: usize,
    cancel: &AtomicBool,
    emit: &(dyn Fn(RunEvent) + Send + Sync),
) -> RunReport {
    let total = hosts.len();
    let results: Mutex<Vec<Option<HostReport>>> = Mutex::new(vec![None; total]);

    let (tx, rx) = mpsc::channel::<usize>();
    for index in 0..total {
        let _ = tx.send(index);
    }
    drop(tx); // so recv() returns Err once the queue drains instead of blocking
    let rx = Mutex::new(rx);

    let worker_count = concurrency.max(1).min(total.max(1));
    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            scope.spawn(|| {
                loop {
                    let next = {
                        let guard = rx.lock().unwrap();
                        guard.recv()
                    };
                    let index = match next {
                        Ok(index) => index,
                        Err(_) => break,
                    };
                    if cancel.load(Ordering::Relaxed) {
                        continue; // drain the queue without executing
                    }
                    let host = &hosts[index];
                    emit(RunEvent::HostStarted {
                        run_id: run_id.to_string(),
                        connection_id: host.connection_id.clone(),
                    });
                    let started = Instant::now();
                    // Stream each output frame to the live grid as it arrives.
                    let on_chunk = |chunk: &str| {
                        emit(RunEvent::HostOutput {
                            run_id: run_id.to_string(),
                            connection_id: host.connection_id.clone(),
                            chunk: chunk.to_string(),
                        });
                    };
                    let outcome = transport.exec(host, task, &on_chunk);
                    let duration_ms = started.elapsed().as_millis() as u64;
                    let bytes_out = outcome.output.len() as u64;
                    emit(RunEvent::HostFinished {
                        run_id: run_id.to_string(),
                        connection_id: host.connection_id.clone(),
                        ok: outcome.ok,
                        exit_code: outcome.exit_code,
                        output: outcome.output.clone(),
                        duration_ms,
                        error: outcome.error.clone(),
                    });
                    results.lock().unwrap()[index] = Some(HostReport {
                        host_id: host.host_id.clone(),
                        connection_id: host.connection_id.clone(),
                        name: host.name.clone(),
                        host: host.host.clone(),
                        transport: host.transport,
                        ok: outcome.ok,
                        exit_code: outcome.exit_code,
                        bytes_out,
                        duration_ms,
                        output: cap_output(outcome.output),
                        error: outcome.error,
                    });
                }
            });
        }
    });

    let host_reports: Vec<HostReport> = results
        .into_inner()
        .unwrap()
        .into_iter()
        .flatten()
        .collect();
    let ok = host_reports.iter().filter(|report| report.ok).count();
    let failed = host_reports.iter().filter(|report| !report.ok).count();
    RunReport {
        ok,
        failed,
        total,
        hosts: host_reports,
    }
}

/// Everything the SSH transport needs to reach one host, resolved up front (DB +
/// keychain) on the calling thread so the worker pool does pure network I/O.
pub struct SshExecSpec {
    pub host: String,
    pub user: String,
    pub port: u16,
    pub auth: NativeSshAuth,
    pub known_hosts_path: PathBuf,
    pub socks_proxy: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub compression: bool,
    pub old_protocols: bool,
}

/// The Phase 2 SSH transport. Holds pre-resolved per-host exec specs and runs
/// each on a fresh authenticated exec channel via `ssh::run_remote_command_capture`.
pub struct SshTransport {
    app: AppHandle,
    specs: HashMap<String, SshExecSpec>,
    task_secrets: HashMap<String, String>,
}

impl SshTransport {
    pub fn new(
        app: AppHandle,
        specs: HashMap<String, SshExecSpec>,
        task_secrets: HashMap<String, String>,
    ) -> Self {
        Self {
            app,
            specs,
            task_secrets,
        }
    }
}

/// Resolve only the vault entries referenced by sudo nodes. Plaintext stays in
/// this in-memory transport map and never enters Task storage or Run History.
pub fn resolve_task_secrets(
    task: &BatchTask,
    secrets: &secrets::Secrets,
) -> Result<HashMap<String, String>, String> {
    let mut resolved = HashMap::new();
    let BatchTask::Playbook { steps, .. } = task else {
        return Ok(resolved);
    };
    for step in steps
        .iter()
        .filter(|step| step.kind == PlaybookStepKind::Sudo)
    {
        let owner_id = step
            .secret_owner_id
            .as_deref()
            .map(str::trim)
            .filter(|owner_id| !owner_id.is_empty())
            .ok_or_else(|| "sudo node has no credential reference".to_string())?;
        let secret = secrets
            .read_itops_task_secret(owner_id.to_string())?
            .ok_or_else(|| "sudo credential is missing from the secret store".to_string())?;
        resolved.insert(owner_id.to_string(), secret);
    }
    Ok(resolved)
}

fn outcome_from_streaming_result(
    result: Result<(i32, String), String>,
    streamed_output: String,
) -> ExecOutcome {
    match result {
        Ok((exit_code, output)) => ExecOutcome {
            ok: exit_code == 0,
            exit_code: Some(exit_code),
            output,
            error: None,
        },
        Err(error) => ExecOutcome {
            ok: false,
            exit_code: None,
            output: streamed_output,
            error: Some(error),
        },
    }
}

impl BatchTransport for SshTransport {
    fn exec(
        &self,
        host: &ResolvedHost,
        task: &BatchTask,
        on_chunk: &(dyn Fn(&str) + Send + Sync),
    ) -> ExecOutcome {
        let Some(spec) = self.specs.get(&host.connection_id) else {
            return ExecOutcome {
                ok: false,
                exit_code: None,
                output: String::new(),
                error: Some("no SSH transport for this Connection".to_string()),
            };
        };
        // `command` is unused for the Playbook path (steps carry their own input),
        // but NativeSshCommandRequest still carries the connection details both
        // transports need, so build it once with an empty command for Playbooks.
        let command = match task {
            BatchTask::Script { body, .. } => body.clone(),
            BatchTask::Playbook { .. } => String::new(),
        };
        let request = NativeSshCommandRequest {
            host: spec.host.clone(),
            user: spec.user.clone(),
            port: spec.port,
            auth: spec.auth.clone(),
            known_hosts_path: spec.known_hosts_path.clone(),
            command,
            timeout_seconds: spec.timeout_seconds,
            socks_proxy: spec.socks_proxy.clone(),
            compression: spec.compression,
            old_protocols: spec.old_protocols,
        };
        // Every sudo credential in play, so we can scrub it from anything the
        // remote PTY echoes back before it reaches the live stream or storage.
        let redactions: Vec<String> = self
            .task_secrets
            .values()
            .filter(|secret| !secret.is_empty())
            .cloned()
            .collect();
        let streamed_output = Mutex::new(String::new());
        let capture_chunk = |chunk: &str| {
            let safe = redact_secrets(chunk, &redactions);
            streamed_output.lock().unwrap().push_str(&safe);
            on_chunk(&safe);
        };
        let mut exec_outcome = match task {
            BatchTask::Script { .. } => {
                let result = ssh::run_remote_command_capture_streaming(request, &capture_chunk);
                outcome_from_streaming_result(result, streamed_output.into_inner().unwrap())
            }
            BatchTask::Playbook { steps, .. } => {
                let mut step_specs = Vec::new();
                for step in steps {
                    match step.kind {
                        PlaybookStepKind::Sudo => {
                            let owner_id = step.secret_owner_id.as_deref().unwrap_or_default();
                            let Some(secret) = self.task_secrets.get(owner_id) else {
                                return ExecOutcome {
                                    ok: false,
                                    exit_code: None,
                                    output: streamed_output.into_inner().unwrap(),
                                    error: Some("sudo credential is unavailable".to_string()),
                                };
                            };
                            let prompt = step
                                .expect
                                .as_deref()
                                .filter(|value| !value.is_empty())
                                .unwrap_or("KKTerm sudo password: ");
                            let quoted_prompt = prompt.replace('\'', "'\"'\"'");
                            step_specs.push(ssh::PlaybookStepSpec {
                                // The `''` splits the ready marker across two adjacent
                                // shell-quoted literals: the shell concatenates them so
                                // printf still emits `__KKTERM_SUDO_READY__`, but the
                                // command echoed back by the PTY reads `SUDO''_READY`,
                                // so the next step's `expect` cannot match this echo and
                                // must wait for sudo to actually succeed.
                                send: format!(
                                    "sudo -S -p '{quoted_prompt}' -v && printf '\\n__KKTERM_SUDO''_READY__\\n'"
                                ),
                                expect: Some(prompt.to_string()),
                                timeout_seconds: step.timeout_seconds,
                                ai_instruction: None,
                            });
                            step_specs.push(ssh::PlaybookStepSpec {
                                send: secret.clone(),
                                expect: Some("__KKTERM_SUDO_READY__".to_string()),
                                timeout_seconds: step.timeout_seconds,
                                ai_instruction: None,
                            });
                        }
                        PlaybookStepKind::Ai => {
                            let Some(instruction) = step
                                .ai_instruction
                                .as_deref()
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                            else {
                                return ExecOutcome {
                                    ok: false,
                                    exit_code: None,
                                    output: streamed_output.into_inner().unwrap(),
                                    error: Some("AI node instruction is required".to_string()),
                                };
                            };
                            step_specs.push(ssh::PlaybookStepSpec {
                                send: String::new(),
                                expect: None,
                                timeout_seconds: step.timeout_seconds,
                                ai_instruction: Some(instruction.to_string()),
                            });
                        }
                        PlaybookStepKind::Command => {
                            step_specs.push(ssh::PlaybookStepSpec {
                                send: step.send.clone(),
                                expect: step.expect.clone(),
                                timeout_seconds: step.timeout_seconds,
                                ai_instruction: None,
                            });
                        }
                    }
                }
                let app = self.app.clone();
                let ai_callback = move |instruction, previous_output| {
                    let app = app.clone();
                    Box::pin(async move {
                        crate::ai::run_playbook_ai_decision(app, instruction, previous_output).await
                    })
                        as std::pin::Pin<
                            Box<
                                dyn std::future::Future<
                                        Output = Result<crate::ai::PlaybookAiDecision, String>,
                                    > + Send,
                            >,
                        >
                };
                let ai_handler: &ssh::PlaybookAiHandler = &ai_callback;
                match ssh::run_playbook_capture_streaming(
                    request,
                    step_specs,
                    Some(ai_handler),
                    &capture_chunk,
                ) {
                    // A timed-out step is a normal completion with ok == false; the
                    // failure message becomes the host's error note. No exit code:
                    // an interactive shell has no per-step status to report.
                    Ok(outcome) => ExecOutcome {
                        ok: outcome.ok,
                        exit_code: None,
                        output: outcome.output,
                        error: outcome.failure,
                    },
                    Err(error) => ExecOutcome {
                        ok: false,
                        exit_code: None,
                        output: streamed_output.into_inner().unwrap(),
                        error: Some(error),
                    },
                }
            }
        };
        // ssh accumulates its own transcript for the returned outcome, so scrub the
        // credential out of the persisted copy too, not just the streamed chunks.
        exec_outcome.output = redact_secrets(&exec_outcome.output, &redactions);
        exec_outcome
    }
}

#[derive(Clone)]
pub struct WindowsExecSpec {
    pub host: String,
    pub username: String,
    pub domain: String,
    pub password: String,
    pub winrm_port: u16,
    pub winrm_use_tls: bool,
    pub winrm_accept_invalid_certs: bool,
    pub psexec_context: WindowsExecutionContext,
    pub timeout_seconds: u64,
}

/// Dispatches each resolved target to SSH, WinRM, or PsExec while preserving a
/// single bounded batch pool and report/event stream.
pub struct RoutedTransport {
    ssh: SshTransport,
    windows: HashMap<String, WindowsExecSpec>,
    runtime: tokio::runtime::Runtime,
}

impl RoutedTransport {
    pub fn new(
        ssh: SshTransport,
        windows: HashMap<String, WindowsExecSpec>,
    ) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .worker_threads(2)
            .thread_name("kkterm-winrm")
            .build()
            .map_err(|error| format!("failed to start WinRM runtime: {error}"))?;
        Ok(Self {
            ssh,
            windows,
            runtime,
        })
    }

    fn exec_winrm(
        &self,
        spec: &WindowsExecSpec,
        task: &BatchTask,
        on_chunk: &(dyn Fn(&str) + Send + Sync),
    ) -> ExecOutcome {
        let BatchTask::Script { body, .. } = task else {
            return ExecOutcome {
                ok: false,
                exit_code: None,
                output: String::new(),
                error: Some(
                    "WinRM currently supports script Tasks; interactive Playbooks require SSH"
                        .to_string(),
                ),
            };
        };
        let mut config = WinrmConfig::default();
        config.port = spec.winrm_port;
        config.use_tls = spec.winrm_use_tls;
        config.accept_invalid_certs = spec.winrm_accept_invalid_certs;
        config.connect_timeout_secs = spec.timeout_seconds.min(30);
        config.operation_timeout_secs = spec.timeout_seconds;
        config.max_output_bytes = Some(MAX_STORED_OUTPUT);
        let credentials = WinrmCredentials::new(
            spec.username.clone(),
            spec.password.clone(),
            spec.domain.clone(),
        );
        let client = match WinrmClient::new(config, credentials) {
            Ok(client) => client,
            Err(error) => {
                return ExecOutcome {
                    ok: false,
                    exit_code: None,
                    output: String::new(),
                    error: Some(format!("WinRM client setup failed: {error}")),
                };
            }
        };
        match self
            .runtime
            .block_on(client.run_powershell(&spec.host, body))
        {
            Ok(result) => {
                let mut output = String::from_utf8_lossy(&result.stdout).into_owned();
                let stderr = String::from_utf8_lossy(&result.stderr);
                if !stderr.is_empty() {
                    if !output.is_empty() && !output.ends_with('\n') {
                        output.push('\n');
                    }
                    output.push_str(&stderr);
                }
                let output = redact_secrets(&output, std::slice::from_ref(&spec.password));
                if !output.is_empty() {
                    on_chunk(&output);
                }
                ExecOutcome {
                    ok: result.exit_code == 0,
                    exit_code: Some(result.exit_code),
                    output,
                    error: None,
                }
            }
            Err(error) => ExecOutcome {
                ok: false,
                exit_code: None,
                output: String::new(),
                error: Some(format!("WinRM execution failed: {error}")),
            },
        }
    }

    #[cfg(target_os = "windows")]
    fn exec_psexec(
        &self,
        spec: &WindowsExecSpec,
        task: &BatchTask,
        on_chunk: &(dyn Fn(&str) + Send + Sync),
    ) -> ExecOutcome {
        let BatchTask::Script { body, .. } = task else {
            return ExecOutcome {
                ok: false,
                exit_code: None,
                output: String::new(),
                error: Some(
                    "PsExec currently supports script Tasks; interactive Playbooks require SSH"
                        .to_string(),
                ),
            };
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(
            body.encode_utf16()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>(),
        );
        let psexec_username = if spec.domain.is_empty() {
            spec.username.clone()
        } else {
            format!("{}\\{}", spec.domain, spec.username)
        };
        let mut last_not_found = None;
        for executable in ["psexec64.exe", "psexec.exe"] {
            let mut command = Command::new(executable);
            command.args([
                "-accepteula",
                "-nobanner",
                "-n",
                &spec.timeout_seconds.to_string(),
                &format!("\\\\{}", spec.host),
                "-u",
                &psexec_username,
                "-p",
                &spec.password,
            ]);
            match spec.psexec_context {
                WindowsExecutionContext::User => {}
                WindowsExecutionContext::Elevated => {
                    command.arg("-h");
                }
                WindowsExecutionContext::System => {
                    command.arg("-s");
                }
                WindowsExecutionContext::Limited => {
                    command.arg("-l");
                }
            }
            command.args([
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                &encoded,
            ]);
            match command.output() {
                Ok(result) => {
                    let mut output = String::from_utf8_lossy(&result.stdout).into_owned();
                    let stderr = String::from_utf8_lossy(&result.stderr);
                    if !stderr.is_empty() {
                        if !output.is_empty() && !output.ends_with('\n') {
                            output.push('\n');
                        }
                        output.push_str(&stderr);
                    }
                    let output = redact_secrets(&output, std::slice::from_ref(&spec.password));
                    if !output.is_empty() {
                        on_chunk(&output);
                    }
                    let exit_code = result.status.code();
                    return ExecOutcome {
                        ok: result.status.success(),
                        exit_code,
                        output,
                        error: None,
                    };
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    last_not_found = Some(error);
                }
                Err(error) => {
                    return ExecOutcome {
                        ok: false,
                        exit_code: None,
                        output: String::new(),
                        error: Some(format!("PsExec launch failed: {error}")),
                    };
                }
            }
        }
        ExecOutcome {
            ok: false,
            exit_code: None,
            output: String::new(),
            error: Some(format!(
                "PsExec was not found in PATH; install Sysinternals PsExec first{}",
                last_not_found
                    .map(|error| format!(": {error}"))
                    .unwrap_or_default()
            )),
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn exec_psexec(
        &self,
        _spec: &WindowsExecSpec,
        _task: &BatchTask,
        _on_chunk: &(dyn Fn(&str) + Send + Sync),
    ) -> ExecOutcome {
        ExecOutcome {
            ok: false,
            exit_code: None,
            output: String::new(),
            error: Some(
                "PsExec execution is available only when KKTerm runs on Windows".to_string(),
            ),
        }
    }
}

impl BatchTransport for RoutedTransport {
    fn exec(
        &self,
        host: &ResolvedHost,
        task: &BatchTask,
        on_chunk: &(dyn Fn(&str) + Send + Sync),
    ) -> ExecOutcome {
        match host.transport {
            Transport::Ssh | Transport::Auto => self.ssh.exec(host, task, on_chunk),
            Transport::Winrm | Transport::Psexec => {
                let Some(spec) = self.windows.get(&host.connection_id) else {
                    return ExecOutcome {
                        ok: false,
                        exit_code: None,
                        output: String::new(),
                        error: Some(
                            "Windows remote credential is missing or unavailable".to_string(),
                        ),
                    };
                };
                if host.transport == Transport::Winrm {
                    self.exec_winrm(spec, task, on_chunk)
                } else {
                    self.exec_psexec(spec, task, on_chunk)
                }
            }
        }
    }
}

pub fn resolve_windows_specs(
    conn: &SqliteConnection,
    secrets: &secrets::Secrets,
    hosts: &[ResolvedHost],
    timeout_seconds: u64,
) -> HashMap<String, WindowsExecSpec> {
    let mut specs = HashMap::new();
    for target in hosts {
        if !matches!(target.transport, Transport::Winrm | Transport::Psexec) {
            continue;
        }
        let Some(host_id) = target.host_id.as_deref() else {
            continue;
        };
        let Ok(host) = super::host_storage::get_host(conn, host_id) else {
            continue;
        };
        let Some(credential_id) = host.execution.credential_id.as_deref() else {
            continue;
        };
        let username = conn
            .query_row(
                "SELECT username FROM connection_password_credentials WHERE id = ?",
                params![credential_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten();
        let password = secrets
            .read_connection_password(credential_id.to_string())
            .ok()
            .flatten();
        let (Some(username), Some(password)) = (username, password) else {
            continue;
        };
        let (domain, username) = username
            .split_once('\\')
            .map(|(domain, username)| (domain.to_string(), username.to_string()))
            .unwrap_or_else(|| (String::new(), username));
        let use_tls = host.execution.winrm_use_tls;
        specs.insert(
            target.connection_id.clone(),
            WindowsExecSpec {
                host: target.host.clone(),
                username,
                domain,
                password,
                winrm_port: host
                    .execution
                    .winrm_port
                    .unwrap_or(if use_tls { 5986 } else { 5985 }),
                winrm_use_tls: use_tls,
                winrm_accept_invalid_certs: host.execution.winrm_accept_invalid_certs,
                psexec_context: host.execution.psexec_context,
                timeout_seconds,
            },
        );
    }
    specs
}

/// Resolve each SSH-typed host to a ready exec spec (host/user/port + auth from
/// the keychain). Windows Host targets are resolved separately above.
pub fn resolve_ssh_specs(
    conn: &SqliteConnection,
    secrets: &secrets::Secrets,
    known_hosts_path: PathBuf,
    hosts: &[ResolvedHost],
    timeout_seconds: u64,
) -> HashMap<String, SshExecSpec> {
    let mut specs = HashMap::new();
    let default_compression = global_default_ssh_compression(conn);
    let default_old_protocols = global_default_ssh_old_protocols(conn);
    for host in hosts {
        if host.connection_type != "ssh" {
            continue;
        }
        if let Some(spec) = resolve_one_ssh_spec(
            conn,
            secrets,
            &known_hosts_path,
            host,
            timeout_seconds,
            &default_compression,
            &default_old_protocols,
        ) {
            specs.insert(host.connection_id.clone(), spec);
        }
    }
    specs
}

/// Read the global SSH compression default (`"off"`/`"fast"`) from the settings
/// blob so batch runs honor the same setting as interactive sessions. Falls back
/// to `"fast"` when the settings row or field is absent.
fn global_default_ssh_compression(conn: &SqliteConnection) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = 'ssh'", [], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
    .and_then(|json| {
        json.get("defaultSshCompression")
            .and_then(|value| value.as_str())
            .map(str::to_string)
    })
    .unwrap_or_else(|| "fast".to_string())
}

/// Read the global legacy SSH key-exchange default (`"off"`/`"legacy"`) from the
/// settings blob so batch runs honor the same setting as interactive sessions.
/// Falls back to `"off"` when the settings row or field is absent.
fn global_default_ssh_old_protocols(conn: &SqliteConnection) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = 'ssh'", [], |row| {
        row.get::<_, String>(0)
    })
    .optional()
    .ok()
    .flatten()
    .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
    .and_then(|json| {
        json.get("defaultSshOldProtocols")
            .and_then(|value| value.as_str())
            .map(str::to_string)
    })
    .unwrap_or_else(|| "off".to_string())
}

fn resolve_one_ssh_spec(
    conn: &SqliteConnection,
    secrets: &secrets::Secrets,
    known_hosts_path: &PathBuf,
    host: &ResolvedHost,
    timeout_seconds: u64,
    default_compression: &str,
    default_old_protocols: &str,
) -> Option<SshExecSpec> {
    let row = conn
        .query_row(
            "SELECT host, username, port, key_path, auth_method, password_credential_id, ssh_socks_proxy, ssh_compression, ssh_old_protocols
             FROM connections WHERE id = ?",
            params![host.connection_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .optional()
        .ok()
        .flatten()?;
    let (
        hostname,
        username,
        port,
        key_path,
        auth_method,
        password_credential_id,
        socks_proxy,
        ssh_compression,
        ssh_old_protocols,
    ) = row;

    let key_path_present = key_path
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let auth = if key_path_present {
        NativeSshAuth::KeyFile {
            key_path: key_path.unwrap_or_default(),
            passphrase: secrets
                .read_connection_passphrase(host.connection_id.clone())
                .ok()
                .flatten(),
        }
    } else if auth_method == "password" {
        let password = password_credential_id
            .and_then(|owner| secrets.read_connection_password(owner).ok().flatten());
        NativeSshAuth::Password { password }
    } else {
        NativeSshAuth::Agent
    };

    Some(SshExecSpec {
        host: hostname,
        user: username,
        port: port.and_then(|port| u16::try_from(port).ok()).unwrap_or(22),
        auth,
        known_hosts_path: known_hosts_path.clone(),
        socks_proxy: socks_proxy.filter(|value| !value.trim().is_empty()),
        timeout_seconds: Some(timeout_seconds),
        compression: ssh::resolve_ssh_compression(ssh_compression.as_deref(), default_compression),
        old_protocols: ssh::resolve_ssh_old_protocols(
            ssh_old_protocols.as_deref(),
            default_old_protocols,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::itops::types::Transport;
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;

    fn host(id: &str) -> ResolvedHost {
        ResolvedHost {
            host_id: None,
            connection_id: id.to_string(),
            name: id.to_string(),
            host: format!("{id}.example"),
            username: "deploy".to_string(),
            port: Some(22),
            connection_type: "ssh".to_string(),
            transport: Transport::Ssh,
        }
    }

    /// Fails hosts whose id is in `fail`; tracks peak concurrency.
    struct MockTransport {
        fail: Vec<String>,
        live: AtomicUsize,
        peak: AtomicUsize,
    }
    impl BatchTransport for MockTransport {
        fn exec(
            &self,
            host: &ResolvedHost,
            _task: &BatchTask,
            on_chunk: &(dyn Fn(&str) + Send + Sync),
        ) -> ExecOutcome {
            let now = self.live.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(now, Ordering::SeqCst);
            on_chunk("done");
            std::thread::sleep(Duration::from_millis(10));
            self.live.fetch_sub(1, Ordering::SeqCst);
            let failed = self.fail.iter().any(|id| id == &host.connection_id);
            ExecOutcome {
                ok: !failed,
                exit_code: Some(if failed { 100 } else { 0 }),
                output: "done".to_string(),
                error: None,
            }
        }
    }

    fn script() -> BatchTask {
        BatchTask::Script {
            body: "echo hi".to_string(),
            shell: None,
        }
    }

    fn playbook() -> BatchTask {
        BatchTask::Playbook {
            name: "restart".to_string(),
            steps: vec![super::super::types::PlaybookStep {
                id: None,
                kind: super::super::types::PlaybookStepKind::Command,
                name: "go".to_string(),
                send: "echo hi".to_string(),
                expect: Some("$".to_string()),
                timeout_seconds: Some(5),
                secret_owner_id: None,
                ai_instruction: None,
            }],
        }
    }

    #[test]
    fn runs_a_playbook_task_through_the_pool() {
        // The runner is transport-agnostic: a Playbook task fans out and tallies
        // exactly like a script. (The real expect/PTY behavior lives in the SSH
        // transport and needs a live host to exercise.)
        let hosts: Vec<ResolvedHost> = ["a", "b"].iter().map(|id| host(id)).collect();
        let transport = MockTransport {
            fail: vec!["b".to_string()],
            live: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        };
        let cancel = AtomicBool::new(false);
        let report = run_batch(
            "run-pb",
            &hosts,
            &playbook(),
            &transport,
            2,
            &cancel,
            &|_| {},
        );
        assert_eq!(report.total, 2);
        assert_eq!(report.ok, 1);
        assert_eq!(report.failed, 1);
    }

    #[test]
    fn tallies_ok_and_failed_over_all_hosts() {
        let hosts: Vec<ResolvedHost> = ["a", "b", "c", "d"].iter().map(|id| host(id)).collect();
        let transport = MockTransport {
            fail: vec!["c".to_string()],
            live: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        };
        let cancel = AtomicBool::new(false);
        let report = run_batch("run-1", &hosts, &script(), &transport, 4, &cancel, &|_| {});
        assert_eq!(report.total, 4);
        assert_eq!(report.ok, 3);
        assert_eq!(report.failed, 1);
        assert_eq!(report.hosts.len(), 4);
        assert_eq!(report.hosts.iter().map(|h| h.bytes_out).sum::<u64>(), 16); // "done" * 4
    }

    #[test]
    fn respects_concurrency_cap() {
        let hosts: Vec<ResolvedHost> = (0..8).map(|i| host(&format!("h{i}"))).collect();
        let transport = MockTransport {
            fail: vec![],
            live: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        };
        let cancel = AtomicBool::new(false);
        run_batch("run-2", &hosts, &script(), &transport, 3, &cancel, &|_| {});
        assert!(transport.peak.load(Ordering::SeqCst) <= 3);
    }

    #[test]
    fn cancel_before_start_runs_nothing() {
        let hosts: Vec<ResolvedHost> = ["a", "b", "c"].iter().map(|id| host(id)).collect();
        let transport = MockTransport {
            fail: vec![],
            live: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        };
        let cancel = AtomicBool::new(true); // already canceled
        let report = run_batch("run-3", &hosts, &script(), &transport, 2, &cancel, &|_| {});
        assert_eq!(report.total, 3);
        assert_eq!(report.hosts.len(), 0); // none executed
        assert_eq!(transport.peak.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn emits_started_and_finished_per_host() {
        let hosts: Vec<ResolvedHost> = ["a", "b"].iter().map(|id| host(id)).collect();
        let transport = MockTransport {
            fail: vec![],
            live: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        };
        let cancel = AtomicBool::new(false);
        let started = AtomicUsize::new(0);
        let finished = AtomicUsize::new(0);
        run_batch(
            "run-4",
            &hosts,
            &script(),
            &transport,
            2,
            &cancel,
            &|event| match event {
                RunEvent::HostStarted { .. } => {
                    started.fetch_add(1, Ordering::SeqCst);
                }
                RunEvent::HostFinished { .. } => {
                    finished.fetch_add(1, Ordering::SeqCst);
                }
                _ => {}
            },
        );
        assert_eq!(started.load(Ordering::SeqCst), 2);
        assert_eq!(finished.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn streams_output_chunks_and_persists_output() {
        let hosts: Vec<ResolvedHost> = ["a", "b"].iter().map(|id| host(id)).collect();
        let transport = MockTransport {
            fail: vec![],
            live: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        };
        let cancel = AtomicBool::new(false);
        let chunks = AtomicUsize::new(0);
        let report = run_batch(
            "run-5",
            &hosts,
            &script(),
            &transport,
            2,
            &cancel,
            &|event| {
                if let RunEvent::HostOutput { .. } = event {
                    chunks.fetch_add(1, Ordering::SeqCst);
                }
            },
        );
        assert_eq!(chunks.load(Ordering::SeqCst), 2); // one "done" frame per host
        assert!(report.hosts.iter().all(|host| host.output == "done"));
    }

    #[test]
    fn redact_secrets_scrubs_every_occurrence() {
        let secrets = vec!["tsai0529".to_string()];
        let transcript = "sudo -S ...\ntsai0529\n__KKTERM_SUDO_READY__\ntsai0529 again\n";
        let redacted = redact_secrets(transcript, &secrets);
        assert!(!redacted.contains("tsai0529"));
        assert_eq!(redacted.matches("••••••").count(), 2);
        assert!(redacted.contains("__KKTERM_SUDO_READY__")); // non-secret output survives
    }

    #[test]
    fn redact_secrets_ignores_empty_secret() {
        // An unset credential must never turn into a blanket match that blanks output.
        let secrets = vec![String::new()];
        let transcript = "nothing secret here";
        assert_eq!(redact_secrets(transcript, &secrets), transcript);
    }

    #[test]
    fn cap_output_truncates_oversized_output() {
        let short = "hello".to_string();
        assert_eq!(cap_output(short.clone()), short);
        let big = "x".repeat(MAX_STORED_OUTPUT + 10);
        let capped = cap_output(big);
        assert!(capped.len() <= MAX_STORED_OUTPUT + 32);
        assert!(capped.ends_with("[output truncated]"));
    }

    #[test]
    fn streaming_failure_keeps_output_received_before_error() {
        let outcome = outcome_from_streaming_result(
            Err("SSH command timed out after 120 seconds".to_string()),
            "work in progress\n".to_string(),
        );

        assert!(!outcome.ok);
        assert_eq!(outcome.exit_code, None);
        assert_eq!(outcome.output, "work in progress\n");
        assert_eq!(
            outcome.error.as_deref(),
            Some("SSH command timed out after 120 seconds")
        );
    }
}

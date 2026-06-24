use russh::{
    Channel, ChannelMsg, Disconnect,
    client::{self, Msg, Session},
    keys::{
        PrivateKeyWithHashAlg,
        agent::{AgentIdentity, client::AgentClient},
        load_secret_key,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    future::Future,
    net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener as StdTcpListener},
    path::PathBuf,
    rc::Rc,
    sync::{Arc, mpsc as std_mpsc},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, copy_bidirectional},
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot},
    task::JoinSet,
};

const SSH_TMUX_RESUME_MAX_ATTEMPTS: usize = 2;
const SSH_TMUX_RESUME_TIMEOUT: Duration = Duration::from_secs(10);
const SSH_TMUX_RESUME_DELAY: Duration = Duration::from_millis(750);
const SSH_STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const SSH_X11_REQUEST_WANT_REPLY: bool = true;
// Upper bound for a one-off command run over a live SSH Session (remote-OS
// detection, system context). It bounds only command execution: queue/auth wait
// is bounded separately by the caller's `recv_timeout`.
const SSH_COMMAND_TIMEOUT: Duration = Duration::from_secs(8);
// Idle SSH sessions must keep sending SSH-level keepalives so NAT/firewall state
// stays alive and a dead link is detected instead of silently freezing input
// (russh equivalent of OpenSSH ServerAliveInterval/ServerAliveCountMax). An
// active session resets this timer on received data, so it adds no traffic.
const SSH_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
// Tear down a dead link after this many unanswered keepalives. With a 30s
// interval that is a ~2.5 min detection window — tight enough to recover an
// idle freeze quickly, loose enough to ride out a brief network blip.
const SSH_KEEPALIVE_MAX_MISSED: usize = 4;
// On session teardown the worker drains live port-forward tasks so their SSH
// channels close while the tokio runtime is still running (russh closes
// channels from a `Drop` that calls `tokio::spawn`, which panics once the
// runtime is gone). This bounds how long teardown waits for a graceful drain
// before forcing the remaining tasks down.
const SSH_FORWARD_SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

fn ssh_debug(event: &str, payload: Value) {
    crate::logging::ssh_debug(event, &payload);
}

fn socks_proxy_endpoint_for_log(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(
        trimmed
            .rsplit_once('@')
            .map(|(_, endpoint)| endpoint)
            .unwrap_or(trimmed)
            .to_string(),
    )
}

fn auth_method_name(auth: &NativeSshAuth) -> &'static str {
    match auth {
        NativeSshAuth::KeyFile { .. } => "keyFile",
        NativeSshAuth::Password {
            password: Some(_), ..
        } => "password",
        NativeSshAuth::Password { password: None } => "interactivePassword",
        NativeSshAuth::Agent => "agent",
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTransportPlan {
    primary_library: &'static str,
    sftp_candidate: &'static str,
    fallback_library: &'static str,
    system_ssh_role: &'static str,
}

pub fn transport_plan() -> SshTransportPlan {
    SshTransportPlan {
        primary_library: "russh",
        sftp_candidate: "russh-sftp",
        fallback_library: "ssh2",
        system_ssh_role: "debug-fallback",
    }
}

pub struct NativeSshTerminal {
    session_id: String,
    control: mpsc::UnboundedSender<SshTerminalControl>,
    worker_tx: mpsc::UnboundedSender<NativeSshWorkerMsg>,
    worker: Option<JoinHandle<()>>,
    terminal_ready_ms: u128,
    x11_forwarding_status: Option<NativeSshX11ForwardingStatus>,
}

impl NativeSshTerminal {
    pub fn terminal_ready_ms(&self) -> u128 {
        self.terminal_ready_ms
    }

    pub fn x11_forwarding_status(&self) -> Option<NativeSshX11ForwardingStatus> {
        self.x11_forwarding_status
    }

    /// A lightweight, cloneable handle that runs one-off commands on this live
    /// SSH Session without holding the SessionManager lock. Reusing the already
    /// authenticated Session means auxiliary probes (remote-OS detection, system
    /// context) need no second connection and no system `ssh` fallback, so they
    /// also work for blank-password Connections that authenticate interactively.
    pub fn command_handle(&self) -> NativeSshCommandHandle {
        NativeSshCommandHandle {
            worker_tx: self.worker_tx.clone(),
        }
    }

    pub fn port_forward_handle(&self) -> NativeSshPortForwardHandle {
        NativeSshPortForwardHandle {
            worker_tx: self.worker_tx.clone(),
        }
    }
}

/// A request to run a command on a live native SSH Session. The worker replies
/// over the sync channel so a blocking caller can wait for the output.
enum NativeSshWorkerMsg {
    Command {
        command: String,
        reply: std_mpsc::SyncSender<Result<String, String>>,
    },
    StartPortForward {
        forward_id: String,
        kind: NativeSshPortForwardKind,
        reply: std_mpsc::SyncSender<Result<(), String>>,
    },
    StopPortForward {
        forward_id: String,
    },
}

pub enum NativeSshPortForwardKind {
    Local {
        listener: StdTcpListener,
        dest_host: String,
        dest_port: u16,
    },
    Dynamic {
        listener: StdTcpListener,
    },
    Remote {
        bind: String,
        listen_port: u16,
        dest_host: String,
        dest_port: u16,
    },
}

enum LivePortForward {
    Listener(oneshot::Sender<()>),
    Remote { bind: String, port: u32 },
}

/// Cloneable handle to a live native SSH Session for running one-off remote
/// commands over a fresh exec channel on the existing authenticated transport.
#[derive(Clone)]
pub struct NativeSshCommandHandle {
    worker_tx: mpsc::UnboundedSender<NativeSshWorkerMsg>,
}

impl NativeSshCommandHandle {
    /// Runs `command` on the live Session and returns its combined output. The
    /// command is queued until the Session finishes authenticating, so for a
    /// blank-password Connection the caller waits for the interactive login to
    /// complete (bounded by `timeout`) before the probe runs.
    pub fn run(&self, command: String, timeout: Duration) -> Result<String, String> {
        let (reply, rx) = std_mpsc::sync_channel(1);
        self.worker_tx
            .send(NativeSshWorkerMsg::Command { command, reply })
            .map_err(|_| "native SSH session is closed".to_string())?;
        rx.recv_timeout(timeout)
            .map_err(|_| format!("SSH command timed out after {} seconds", timeout.as_secs()))?
    }
}

#[derive(Clone)]
pub struct NativeSshPortForwardHandle {
    worker_tx: mpsc::UnboundedSender<NativeSshWorkerMsg>,
}

impl NativeSshPortForwardHandle {
    pub fn start(
        &self,
        forward_id: String,
        kind: NativeSshPortForwardKind,
        timeout: Duration,
    ) -> Result<(), String> {
        let (reply, rx) = std_mpsc::sync_channel(1);
        self.worker_tx
            .send(NativeSshWorkerMsg::StartPortForward {
                forward_id,
                kind,
                reply,
            })
            .map_err(|_| "native SSH session is closed".to_string())?;
        rx.recv_timeout(timeout)
            .map_err(|_| "timed out while starting SSH port forward".to_string())?
    }

    pub fn stop(&self, forward_id: String) {
        let _ = self
            .worker_tx
            .send(NativeSshWorkerMsg::StopPortForward { forward_id });
    }
}

#[derive(Clone)]
pub struct NativeSshTerminalRequest {
    pub session_id: String,
    pub host: String,
    pub user: String,
    pub port: u16,
    pub auth: NativeSshAuth,
    pub known_hosts_path: PathBuf,
    pub cols: u16,
    pub pixel_height: u16,
    pub pixel_width: u16,
    pub rows: u16,
    pub initial_directory: Option<String>,
    pub use_tmux: bool,
    pub tmux_session_id: Option<String>,
    pub tmux_history_limit: u32,
    pub x11_forwarding: Option<NativeSshX11Forwarding>,
    pub socks_proxy: Option<String>,
    pub compression: bool,
}

#[derive(Clone)]
pub struct NativeSshX11Forwarding {
    pub display: u16,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeSshX11ForwardingStatus {
    Enabled,
    Rejected,
}

type NativeSshReadyResult = (u128, Option<NativeSshX11ForwardingStatus>);

#[derive(Clone)]
pub(crate) struct NativeSshConnectionRequest {
    pub host: String,
    pub user: String,
    pub port: u16,
    pub auth: NativeSshAuth,
    pub known_hosts_path: PathBuf,
    pub x11_forwarding: Option<NativeSshX11Forwarding>,
    pub socks_proxy: Option<String>,
    pub compression: bool,
    pub(crate) remote_forward_targets: Option<RemoteForwardTargets>,
    pub(crate) bridge_tasks: Option<SshBridgeTasks>,
}

#[derive(Clone)]
pub(crate) struct NativeSshCommandRequest {
    pub host: String,
    pub user: String,
    pub port: u16,
    pub auth: NativeSshAuth,
    pub known_hosts_path: PathBuf,
    pub command: String,
    pub timeout_seconds: Option<u64>,
    pub socks_proxy: Option<String>,
}

#[derive(Clone)]
pub enum NativeSshAuth {
    KeyFile {
        key_path: String,
        passphrase: Option<String>,
    },
    Password { password: Option<String> },
    Agent,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectSshHostKeyRequest {
    pub host: String,
    pub port: Option<u16>,
    #[serde(default)]
    pub ssh_socks_proxy: Option<String>,
    #[serde(default)]
    pub ssh_socks_proxy_username: Option<String>,
    #[serde(default)]
    pub ssh_socks_proxy_secret_owner_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustSshHostKeyRequest {
    host: String,
    port: Option<u16>,
    public_key: String,
    #[serde(default)]
    replace: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKeyPreview {
    host: String,
    port: u16,
    algorithm: String,
    fingerprint: String,
    public_key: String,
    status: String,
}

enum SshTerminalControl {
    Input(Vec<u8>),
    Resize {
        cols: u16,
        pixel_height: u16,
        pixel_width: u16,
        rows: u16,
    },
    Close,
}

#[derive(Debug, PartialEq, Eq)]
enum TerminalRunOutcome {
    Closed,
    Disconnected,
}

pub(crate) struct VerifyingClient {
    host: String,
    port: u16,
    known_hosts_path: PathBuf,
    rejection: Arc<std::sync::Mutex<Option<String>>>,
    x11_forwarding: Option<NativeSshX11Forwarding>,
    remote_forward_targets: Option<RemoteForwardTargets>,
    bridge_tasks: Option<SshBridgeTasks>,
}

pub(crate) type RemoteForwardTargets = Arc<std::sync::Mutex<HashMap<(String, u32), (String, u16)>>>;

// Tracks the detached bridge tasks that russh spawns when the *server* opens a
// channel back to us — X11 channels and remote (`-R`) forwarded-tcpip channels.
// Like the local/dynamic forward tasks, these own SSH channel streams that must
// be closed while the tokio runtime is alive (russh closes them from a `Drop`
// that calls `tokio::spawn`), so the worker drains this set on teardown.
pub(crate) type SshBridgeTasks = Arc<std::sync::Mutex<JoinSet<()>>>;

impl client::Handler for VerifyingClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        match host_key_status(
            &self.host,
            self.port,
            server_public_key,
            &self.known_hosts_path,
        ) {
            Ok(HostKeyTrustStatus::Trusted) => Ok(true),
            Ok(HostKeyTrustStatus::Unknown) => {
                remember_rejection(
                    &self.rejection,
                    format!(
                        "SSH host key for {}:{} is not trusted yet ({})",
                        self.host,
                        self.port,
                        host_key_fingerprint(server_public_key)
                    ),
                );
                Ok(false)
            }
            Ok(HostKeyTrustStatus::Changed { line }) => {
                remember_rejection(
                    &self.rejection,
                    format!(
                        "SSH host key for {}:{} changed from the trusted key at known-hosts line {} ({})",
                        self.host,
                        self.port,
                        line,
                        host_key_fingerprint(server_public_key)
                    ),
                );
                Ok(false)
            }
            Err(error) => {
                remember_rejection(&self.rejection, error);
                Ok(false)
            }
        }
    }

    fn server_channel_open_x11(
        &mut self,
        channel: Channel<Msg>,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut Session,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let x11_forwarding = self.x11_forwarding.clone();
        let bridge_tasks = self.bridge_tasks.clone();
        async move {
            if let Some(x11_forwarding) = x11_forwarding {
                spawn_bridge_task(&bridge_tasks, async move {
                    if let Err(error) = bridge_x11_channel(channel, x11_forwarding.display).await {
                        ssh_debug("bridge.x11.error", json!({ "error": error }));
                    }
                });
            }
            Ok(())
        }
    }

    fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut Session,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let target = self.remote_forward_targets.as_ref().and_then(|targets| {
            targets.lock().ok().and_then(|targets| {
                targets
                    .get(&(connected_address.to_string(), connected_port))
                    .or_else(|| {
                        targets
                            .iter()
                            .find(|((_, port), _)| *port == connected_port)
                            .map(|(_, target)| target)
                    })
                    .cloned()
            })
        });
        let bridge_tasks = self.bridge_tasks.clone();
        async move {
            if let Some((dest_host, dest_port)) = target {
                spawn_bridge_task(&bridge_tasks, async move {
                    if let Err(error) =
                        bridge_remote_forward_channel(channel, dest_host, dest_port).await
                    {
                        ssh_debug("bridge.remote_forward.error", json!({ "error": error }));
                    }
                });
            }
            Ok(())
        }
    }

    fn disconnected(
        &mut self,
        reason: client::DisconnectReason<Self::Error>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        let host = self.host.clone();
        let port = self.port;
        async move {
            match reason {
                client::DisconnectReason::ReceivedDisconnect(info) => {
                    ssh_debug(
                        "connection.disconnected.remote",
                        json!({
                            "host": host,
                            "port": port,
                            "reasonCode": format!("{:?}", info.reason_code),
                            "message": info.message,
                            "languageTag": info.lang_tag,
                        }),
                    );
                    Ok(())
                }
                client::DisconnectReason::Error(error) => {
                    ssh_debug(
                        "connection.disconnected.error",
                        json!({
                            "host": host,
                            "port": port,
                            "error": error.to_string(),
                        }),
                    );
                    Err(error)
                }
            }
        }
    }
}

struct InspectingClient {
    server_public_key: Arc<std::sync::Mutex<Option<russh::keys::ssh_key::PublicKey>>>,
}

impl client::Handler for InspectingClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        if let Ok(mut captured_key) = self.server_public_key.lock() {
            *captured_key = Some(server_public_key.clone());
        }
        Ok(true)
    }
}

pub fn can_start_native_terminal(
    key_path: Option<&str>,
    password: Option<&str>,
    use_agent: bool,
    interactive_password: bool,
    proxy_jump: Option<&str>,
) -> bool {
    let has_key_path = key_path
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let has_password = password
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    let has_proxy_jump = proxy_jump
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());

    (has_key_path || has_password || use_agent || interactive_password) && !has_proxy_jump
}

pub fn start_native_terminal(
    app: AppHandle,
    request: NativeSshTerminalRequest,
) -> Result<NativeSshTerminal, String> {
    let host = request.host.trim();
    if host.is_empty() {
        return Err("host is required for SSH sessions".to_string());
    }

    let user = request.user.trim();
    if user.is_empty() {
        return Err("user is required for native SSH sessions".to_string());
    }

    let auth = normalize_native_ssh_auth(request.auth)?;
    let request = NativeSshTerminalRequest {
        session_id: request.session_id,
        host: host.to_string(),
        user: user.to_string(),
        port: request.port,
        auth,
        known_hosts_path: request.known_hosts_path,
        cols: request.cols,
        pixel_height: request.pixel_height,
        pixel_width: request.pixel_width,
        rows: request.rows,
        initial_directory: request.initial_directory,
        use_tmux: request.use_tmux,
        tmux_session_id: request.tmux_session_id,
        tmux_history_limit: clamp_tmux_history_limit(request.tmux_history_limit),
        x11_forwarding: request.x11_forwarding,
        socks_proxy: request.socks_proxy,
        compression: request.compression,
    };
    ssh_debug(
        "terminal.start",
        json!({
            "sessionId": request.session_id,
            "host": request.host,
            "port": request.port,
            "user": request.user,
            "authMethod": auth_method_name(&request.auth),
            "socksProxyConfigured": request.socks_proxy.as_deref().is_some_and(|value| !value.trim().is_empty()),
            "socksProxyEndpoint": request.socks_proxy.as_deref().and_then(socks_proxy_endpoint_for_log),
            "useTmux": request.use_tmux,
            "x11Forwarding": request.x11_forwarding.is_some(),
            "cols": request.cols,
            "rows": request.rows,
        }),
    );
    let (control_tx, control_rx) = mpsc::unbounded_channel();
    let (worker_tx, worker_rx) = mpsc::unbounded_channel();
    let (ready_tx, ready_rx) = std_mpsc::sync_channel(1);
    let returns_before_ready = matches!(request.auth, NativeSshAuth::Password { password: None });
    let session_id = request.session_id.clone();
    let worker = thread::spawn(move || {
        let result = run_native_terminal_thread(
            app.clone(),
            request.clone(),
            control_rx,
            worker_rx,
            ready_tx,
        );
        if let Err(error) = result {
            ssh_debug(
                "terminal.worker.error",
                json!({
                    "sessionId": request.session_id,
                    "error": error,
                }),
            );
            emit_terminal_output(
                &app,
                &request.session_id,
                format!("\r\n[native SSH session error: {error}]\r\n"),
            );
        }
    });

    if returns_before_ready {
        return Ok(NativeSshTerminal {
            session_id,
            control: control_tx,
            worker_tx,
            worker: Some(worker),
            terminal_ready_ms: 0,
            x11_forwarding_status: None,
        });
    }

    match ready_rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| "timed out while starting native SSH session".to_string())?
    {
        Ok((terminal_ready_ms, x11_forwarding_status)) => Ok(NativeSshTerminal {
            session_id,
            control: control_tx,
            worker_tx,
            worker: Some(worker),
            terminal_ready_ms,
            x11_forwarding_status,
        }),
        Err(error) => {
            let _ = worker.join();
            Err(error)
        }
    }
}

pub fn app_known_hosts_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?
        .join("ssh_known_hosts"))
}

pub fn inspect_host_key(
    known_hosts_path: PathBuf,
    request: InspectSshHostKeyRequest,
) -> Result<SshHostKeyPreview, String> {
    let host = required_host(request.host)?;
    let port = request.port.unwrap_or(22);
    let socks_proxy = request
        .ssh_socks_proxy
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let server_public_key = Arc::new(std::sync::Mutex::new(None));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create SSH host-key runtime: {error}"))?;

    let key = runtime.block_on(async {
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(SSH_STARTUP_TIMEOUT),
            ..Default::default()
        });
        let capture = Arc::clone(&server_public_key);
        with_ssh_startup_timeout("inspecting SSH host key", async {
            let inspecting = InspectingClient {
                server_public_key: capture,
            };
            let session = match socks_proxy.as_deref() {
                Some(proxy) => {
                    let stream =
                        crate::socks::connect_via_socks5(proxy, host.as_str(), port).await?;
                    client::connect_stream(config, stream, inspecting).await
                }
                None => client::connect(config, (host.as_str(), port), inspecting).await,
            }
            .map_err(|error| format!("failed to inspect SSH host key: {error}"))?;
            let _ = session
                .disconnect(Disconnect::ByApplication, "host key inspected", "en")
                .await;
            server_public_key
                .lock()
                .map_err(|_| "SSH host-key capture lock is poisoned".to_string())?
                .clone()
                .ok_or_else(|| "SSH server did not present a host key".to_string())
        })
        .await
    })?;

    let status = host_key_status(&host, port, &key, &known_hosts_path)?;
    Ok(SshHostKeyPreview {
        host,
        port,
        algorithm: key.algorithm().to_string(),
        fingerprint: host_key_fingerprint(&key),
        public_key: key
            .to_openssh()
            .map_err(|error| format!("failed to encode SSH host key: {error}"))?,
        status: status.as_str().to_string(),
    })
}

pub fn trust_host_key(
    known_hosts_path: PathBuf,
    request: TrustSshHostKeyRequest,
) -> Result<SshHostKeyPreview, String> {
    let host = required_host(request.host)?;
    let port = request.port.unwrap_or(22);
    let key = russh::keys::ssh_key::PublicKey::from_openssh(&request.public_key)
        .map_err(|error| format!("failed to parse SSH host key: {error}"))?;
    match host_key_status(&host, port, &key, &known_hosts_path)? {
        HostKeyTrustStatus::Trusted => {}
        HostKeyTrustStatus::Unknown => {
            russh::keys::known_hosts::learn_known_hosts_path(&host, port, &key, &known_hosts_path)
                .map_err(|error| format!("failed to trust SSH host key: {error}"))?;
        }
        HostKeyTrustStatus::Changed { line } => {
            if !request.replace {
                return Err(format!(
                    "refusing to replace changed SSH host key at known-hosts line {line}"
                ));
            }
            replace_changed_host_key(&host, port, &key, &known_hosts_path)?;
        }
    }

    Ok(SshHostKeyPreview {
        host,
        port,
        algorithm: key.algorithm().to_string(),
        fingerprint: host_key_fingerprint(&key),
        public_key: key
            .to_openssh()
            .map_err(|error| format!("failed to encode SSH host key: {error}"))?,
        status: "trusted".to_string(),
    })
}

fn replace_changed_host_key(
    host: &str,
    port: u16,
    key: &russh::keys::ssh_key::PublicKey,
    known_hosts_path: &PathBuf,
) -> Result<(), String> {
    // Drop every stale entry that conflicts with the new key (there can be more
    // than one, e.g. one per algorithm) before learning the rotated key.
    while let HostKeyTrustStatus::Changed { line } =
        host_key_status(host, port, key, known_hosts_path)?
    {
        remove_known_hosts_line(known_hosts_path, line)?;
    }
    russh::keys::known_hosts::learn_known_hosts_path(host, port, key, known_hosts_path)
        .map_err(|error| format!("failed to trust SSH host key: {error}"))
}

fn remove_known_hosts_line(known_hosts_path: &PathBuf, line: usize) -> Result<(), String> {
    let contents = std::fs::read_to_string(known_hosts_path)
        .map_err(|error| format!("failed to read SSH known hosts: {error}"))?;
    let mut lines: Vec<&str> = contents.lines().collect();
    if line == 0 || line > lines.len() {
        return Err(format!("SSH known-hosts line {line} is out of range"));
    }
    lines.remove(line - 1);
    let mut rebuilt = lines.join("\n");
    if !rebuilt.is_empty() {
        rebuilt.push('\n');
    }
    std::fs::write(known_hosts_path, rebuilt)
        .map_err(|error| format!("failed to update SSH known hosts: {error}"))
}

pub(crate) fn run_remote_command(request: NativeSshCommandRequest) -> Result<String, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create native SSH command runtime: {error}"))?;

    let timeout_seconds = request.timeout_seconds;
    if let Some(timeout_seconds) = timeout_seconds {
        runtime.block_on(async {
            tokio::time::timeout(
                Duration::from_secs(timeout_seconds),
                run_remote_command_async(request),
            )
            .await
            .map_err(|_| format!("SSH command timed out after {timeout_seconds} seconds"))?
        })
    } else {
        runtime.block_on(run_remote_command_async(request))
    }
}

async fn run_remote_command_async(request: NativeSshCommandRequest) -> Result<String, String> {
    let session = connect_verified_client(NativeSshConnectionRequest {
        host: request.host,
        user: request.user,
        port: request.port,
        auth: request.auth,
        known_hosts_path: request.known_hosts_path,
        x11_forwarding: None,
        socks_proxy: request.socks_proxy,
        compression: true,
        remote_forward_targets: None,
        bridge_tasks: None,
    })
    .await?;

    let result = exec_collect_on_session(&session, request.command).await;
    disconnect_ssh_session(&session, "command completed").await?;
    result
}

/// Opens a fresh exec channel on an already-connected Session, runs `command`,
/// and returns its combined stdout/stderr. The Session is left connected so a
/// live terminal Session can be reused for background probes. A non-zero exit
/// status is folded into an error (probes treat that as failure).
async fn exec_collect_on_session(
    session: &client::Handle<VerifyingClient>,
    command: String,
) -> Result<String, String> {
    let (exit_status, output) = exec_collect_on_session_with_status(session, command).await?;
    if exit_status == 0 {
        Ok(output)
    } else {
        Err(format!(
            "SSH command exited with status {exit_status}: {output}"
        ))
    }
}

/// Like `exec_collect_on_session` but returns the remote exit status alongside
/// the combined output instead of folding a non-zero status into an error. A
/// Batch Run needs the per-host exit code even when the command "failed", so it
/// can report exit 100 (or whatever) rather than just "errored".
async fn exec_collect_on_session_with_status(
    session: &client::Handle<VerifyingClient>,
    command: String,
) -> Result<(i32, String), String> {
    exec_stream_on_session_with_status(session, command, &|_| {}).await
}

/// Streaming sibling of `exec_collect_on_session_with_status`: invokes `on_chunk`
/// for each stdout/stderr frame as it arrives — so a Batch Run can show live
/// per-host output — while still accumulating and returning the full combined
/// output plus the remote exit status. `on_chunk` runs on the SSH I/O task and
/// must not block.
async fn exec_stream_on_session_with_status(
    session: &client::Handle<VerifyingClient>,
    command: String,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> Result<(i32, String), String> {
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|error| format!("failed to open SSH command channel: {error}"))?;
    channel
        .exec(false, command.into_bytes())
        .await
        .map_err(|error| format!("failed to run SSH command: {error}"))?;

    let mut output = String::new();
    let mut exit_status: u32 = 0;
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                let text = String::from_utf8_lossy(&data);
                on_chunk(&text);
                output.push_str(&text);
            }
            ChannelMsg::ExitStatus {
                exit_status: status,
            } => {
                exit_status = status;
            }
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }

    let _ = channel.eof().await;
    let _ = channel.close().await;
    Ok((exit_status as i32, output))
}

async fn run_remote_command_async_capture(
    request: NativeSshCommandRequest,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> Result<(i32, String), String> {
    let session = connect_verified_client(NativeSshConnectionRequest {
        host: request.host,
        user: request.user,
        port: request.port,
        auth: request.auth,
        known_hosts_path: request.known_hosts_path,
        x11_forwarding: None,
        socks_proxy: request.socks_proxy,
        compression: true,
        remote_forward_targets: None,
        bridge_tasks: None,
    })
    .await?;

    let result = exec_stream_on_session_with_status(&session, request.command, on_chunk).await;
    disconnect_ssh_session(&session, "command completed").await?;
    result
}

/// Blocking one-shot remote exec that returns `(exit_code, combined_output)` and
/// streams each output frame to `on_chunk` as it arrives, so the IT Ops Batch Run
/// grid can show live per-host output. Unlike `run_remote_command`, a non-zero
/// remote exit is a normal result, not an error; `Err` is reserved for
/// connect/auth/transport failures. This is the primitive the Batch Run SSH
/// transport runs per host. Pass a no-op `on_chunk` for a non-streaming capture.
pub(crate) fn run_remote_command_capture_streaming(
    request: NativeSshCommandRequest,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> Result<(i32, String), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create native SSH command runtime: {error}"))?;

    let timeout_seconds = request.timeout_seconds;
    if let Some(timeout_seconds) = timeout_seconds {
        runtime.block_on(async {
            tokio::time::timeout(
                Duration::from_secs(timeout_seconds),
                run_remote_command_async_capture(request, on_chunk),
            )
            .await
            .map_err(|_| format!("SSH command timed out after {timeout_seconds} seconds"))?
        })
    } else {
        runtime.block_on(run_remote_command_async_capture(request, on_chunk))
    }
}

impl NativeSshTerminal {
    pub fn write_input(&self, data: Vec<u8>) -> Result<(), String> {
        let bytes = data.len();
        ssh_debug(
            "terminal.input.enqueue",
            json!({
                "sessionId": self.session_id,
                "bytes": bytes,
            }),
        );
        self.control
            .send(SshTerminalControl::Input(data))
            .map_err(|_| {
                ssh_debug(
                    "terminal.input.enqueue_error",
                    json!({
                        "bytes": bytes,
                        "sessionId": self.session_id,
                        "error": "native SSH session is closed",
                    }),
                );
                "native SSH session is closed".to_string()
            })
    }

    pub fn resize(
        &self,
        cols: u16,
        rows: u16,
        pixel_width: u16,
        pixel_height: u16,
    ) -> Result<(), String> {
        self.control
            .send(SshTerminalControl::Resize {
                cols,
                pixel_height,
                pixel_width,
                rows,
            })
            .map_err(|_| "native SSH session is closed".to_string())
    }

    pub fn close(mut self) {
        ssh_debug(
            "terminal.close.request",
            json!({
                "sessionId": self.session_id,
            }),
        );
        let _ = self.control.send(SshTerminalControl::Close);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn run_native_terminal_thread(
    app: AppHandle,
    request: NativeSshTerminalRequest,
    control_rx: mpsc::UnboundedReceiver<SshTerminalControl>,
    worker_rx: mpsc::UnboundedReceiver<NativeSshWorkerMsg>,
    ready_tx: std_mpsc::SyncSender<Result<NativeSshReadyResult, String>>,
) -> Result<(), String> {
    let session_id = request.session_id.clone();
    let startup_error_tx = ready_tx.clone();
    // Catch panics on the SSH worker thread so a fault here (including a
    // third-party `Drop` panic during teardown) is logged and contained to this
    // one session rather than escaping. With `panic = "unwind"` the panic stops
    // at this boundary; the parent already turns a worker error into a closed
    // session via `worker.join()`. The runtime/LocalSet are built and dropped
    // *inside* the catch so teardown-time panics are caught too.
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("failed to create native SSH runtime: {error}"))?;

        // A LocalSet lets background command probes run as `!Send` local tasks
        // (russh's `client::Handle` is not `Sync`, so it cannot cross `tokio::spawn`).
        let local = tokio::task::LocalSet::new();
        local.block_on(
            &runtime,
            run_native_terminal(app, request, control_rx, worker_rx, ready_tx),
        )
    }));

    let result = match outcome {
        Ok(result) => result,
        Err(panic) => {
            let message = panic_payload_message(panic.as_ref());
            ssh_debug(
                "worker.panic",
                json!({ "sessionId": session_id, "message": message }),
            );
            Err(format!("native SSH worker thread panicked: {message}"))
        }
    };

    if let Err(error) = &result {
        let _ = startup_error_tx.send(Err(error.clone()));
    }
    result
}

/// Best-effort extraction of a human-readable message from a caught panic
/// payload (`catch_unwind` yields `Box<dyn Any>`), used for diagnostic logs.
fn panic_payload_message(panic: &(dyn std::any::Any + Send)) -> String {
    if let Some(message) = panic.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = panic.downcast_ref::<String>() {
        message.clone()
    } else {
        "unknown panic".to_string()
    }
}

async fn run_native_terminal(
    app: AppHandle,
    request: NativeSshTerminalRequest,
    mut control_rx: mpsc::UnboundedReceiver<SshTerminalControl>,
    mut worker_rx: mpsc::UnboundedReceiver<NativeSshWorkerMsg>,
    ready_tx: std_mpsc::SyncSender<Result<NativeSshReadyResult, String>>,
) -> Result<(), String> {
    let current_request = request;
    let mut ready_tx = Some(ready_tx);
    let mut resume_attempts = 0;

    loop {
        let is_initial_start = ready_tx.is_some();
        let timeout = if is_initial_start {
            SSH_STARTUP_TIMEOUT
        } else {
            SSH_TMUX_RESUME_TIMEOUT
        };
        ssh_debug(
            "terminal.run.attempt",
            json!({
                "sessionId": current_request.session_id,
                "initialStart": is_initial_start,
                "resumeAttempts": resume_attempts,
                "startupTimeoutMs": timeout.as_millis(),
            }),
        );
        let result = run_native_terminal_once(
            &app,
            &current_request,
            &mut control_rx,
            &mut worker_rx,
            ready_tx.take(),
            timeout,
        )
        .await;

        match result {
            Ok(TerminalRunOutcome::Closed) => {
                ssh_debug(
                    "terminal.run.closed",
                    json!({
                        "sessionId": current_request.session_id,
                    }),
                );
                return Ok(());
            }
            Ok(TerminalRunOutcome::Disconnected) if can_resume_tmux_terminal(&current_request) => {
                ssh_debug(
                    "terminal.run.disconnected_resume_pending",
                    json!({
                        "sessionId": current_request.session_id,
                        "resumeAttempts": resume_attempts,
                        "willResume": resume_attempts < SSH_TMUX_RESUME_MAX_ATTEMPTS,
                    }),
                );
            }
            Ok(TerminalRunOutcome::Disconnected) => {
                ssh_debug(
                    "terminal.run.disconnected",
                    json!({
                        "sessionId": current_request.session_id,
                    }),
                );
                return Ok(());
            }
            Err(error) if can_resume_tmux_terminal(&current_request) => {
                if is_initial_start {
                    ssh_debug(
                        "terminal.run.initial_error",
                        json!({
                            "sessionId": current_request.session_id,
                            "error": error,
                        }),
                    );
                    return Err(error);
                }
                ssh_debug(
                    "terminal.run.error_resume_pending",
                    json!({
                        "sessionId": current_request.session_id,
                        "resumeAttempts": resume_attempts,
                        "error": error,
                        "willResume": resume_attempts < SSH_TMUX_RESUME_MAX_ATTEMPTS,
                    }),
                );
            }
            Err(error) => {
                ssh_debug(
                    "terminal.run.error",
                    json!({
                        "sessionId": current_request.session_id,
                        "error": error,
                    }),
                );
                return Err(error);
            }
        }

        if control_rx.is_closed() {
            ssh_debug(
                "terminal.run.control_closed",
                json!({
                    "sessionId": current_request.session_id,
                    "resumeAttempts": resume_attempts,
                }),
            );
            return Ok(());
        }

        if resume_attempts >= SSH_TMUX_RESUME_MAX_ATTEMPTS {
            ssh_debug(
                "terminal.run.resume_exhausted",
                json!({
                    "sessionId": current_request.session_id,
                    "resumeAttempts": resume_attempts,
                }),
            );
            emit_terminal_output(
                &app,
                &current_request.session_id,
                "\r\n[native SSH session disconnected after repeated tmux resume attempts]\r\n"
                    .to_string(),
            );
            return Ok(());
        }

        resume_attempts += 1;
        tokio::time::sleep(SSH_TMUX_RESUME_DELAY).await;
    }
}

async fn run_native_terminal_once(
    app: &AppHandle,
    request: &NativeSshTerminalRequest,
    control_rx: &mut mpsc::UnboundedReceiver<SshTerminalControl>,
    worker_rx: &mut mpsc::UnboundedReceiver<NativeSshWorkerMsg>,
    ready_tx: Option<std_mpsc::SyncSender<Result<NativeSshReadyResult, String>>>,
    startup_timeout: Duration,
) -> Result<TerminalRunOutcome, String> {
    let remote_forward_targets = RemoteForwardTargets::default();
    let bridge_tasks: SshBridgeTasks = Arc::new(std::sync::Mutex::new(JoinSet::new()));
    let startup = async {
        ssh_debug(
            "terminal.startup.begin",
            json!({
                "sessionId": request.session_id,
                "host": request.host,
                "port": request.port,
                "user": request.user,
                "socksProxyConfigured": request.socks_proxy.as_deref().is_some_and(|value| !value.trim().is_empty()),
            }),
        );
        let mut prompt = TerminalAuthPrompt {
            app,
            session_id: &request.session_id,
            control_rx,
        };
        let session = connect_verified_client_with_prompt(
            NativeSshConnectionRequest {
                host: request.host.clone(),
                user: request.user.clone(),
                port: request.port,
                auth: request.auth.clone(),
                known_hosts_path: request.known_hosts_path.clone(),
                x11_forwarding: request.x11_forwarding.clone(),
                socks_proxy: request.socks_proxy.clone(),
                compression: request.compression,
                remote_forward_targets: Some(Arc::clone(&remote_forward_targets)),
                bridge_tasks: Some(Arc::clone(&bridge_tasks)),
            },
            Some(&mut prompt),
        )
        .await?;

        let ready_start = Instant::now();
        let channel = session
            .channel_open_session()
            .await
            .map_err(|error| format!("failed to open SSH terminal channel: {error}"))?;
        ssh_debug(
            "terminal.channel.opened",
            json!({
                "sessionId": request.session_id,
            }),
        );
        channel
            .request_pty(
                false,
                "xterm-256color",
                request.cols.into(),
                request.rows.into(),
                request.pixel_width.into(),
                request.pixel_height.into(),
                &[],
            )
            .await
            .map_err(|error| format!("failed to allocate SSH PTY: {error}"))?;
        ssh_debug(
            "terminal.pty.allocated",
            json!({
                "sessionId": request.session_id,
                "cols": request.cols,
                "rows": request.rows,
                "pixelWidth": request.pixel_width,
                "pixelHeight": request.pixel_height,
            }),
        );
        let x11_forwarding_status = if request.x11_forwarding.is_some() {
            let status = match channel
                .request_x11(
                    SSH_X11_REQUEST_WANT_REPLY,
                    false,
                    "MIT-MAGIC-COOKIE-1",
                    x11_auth_cookie(),
                    0,
                )
                .await
            {
                Ok(()) => NativeSshX11ForwardingStatus::Enabled,
                Err(error) => {
                    eprintln!("SSH X11 forwarding request rejected: {error}");
                    NativeSshX11ForwardingStatus::Rejected
                }
            };
            Some(status)
        } else {
            None
        };
        channel
            .request_shell(false)
            .await
            .map_err(|error| format!("failed to start SSH shell: {error}"))?;
        ssh_debug(
            "terminal.shell.started",
            json!({
                "sessionId": request.session_id,
            }),
        );
        if let Some(command) = startup_command_for(request) {
            channel
                .data(format!("{command}\r").as_bytes())
                .await
                .map_err(|error| format!("failed to initialize SSH shell: {error}"))?;
            ssh_debug(
                "terminal.startup_command.sent",
                json!({
                    "sessionId": request.session_id,
                    "useTmux": request.use_tmux,
                    "hasInitialDirectory": initial_directory_for(request).is_some(),
                }),
            );
        }

        Ok::<_, String>((
            session,
            channel,
            ready_start.elapsed().as_millis(),
            x11_forwarding_status,
        ))
    };

    let startup_result = if matches!(request.auth, NativeSshAuth::Password { password: None }) {
        startup.await
    } else {
        tokio::time::timeout(startup_timeout, startup)
            .await
            .map_err(|_| "timed out while starting native SSH session".to_string())?
    };
    let (session, mut channel, terminal_ready_ms, x11_forwarding_status) = startup_result?;
    // Share the authenticated Session so background probes can open their own
    // exec channels without a second connection. `client::Handle` is not Clone,
    // so an Rc provides the shared, read-only access the local probe tasks need.
    let session = Rc::new(session);
    let mut live_port_forwards = HashMap::<String, LivePortForward>::new();
    // Tracks the listener tasks for every live port forward so they (and the
    // per-connection tasks they own) can be drained on teardown while the tokio
    // runtime is still running. Without this, abandoned forward channels are
    // dropped after the runtime stops, and russh's channel `Drop` panics by
    // calling `tokio::spawn` with no runtime — which crashes the whole app.
    let mut forward_tasks: JoinSet<()> = JoinSet::new();

    if let Some(ready_tx) = ready_tx {
        let _ = ready_tx.send(Ok((terminal_ready_ms, x11_forwarding_status)));
    }
    ssh_debug(
        "terminal.ready",
        json!({
            "sessionId": request.session_id,
            "terminalReadyMs": terminal_ready_ms,
            "x11ForwardingStatus": x11_forwarding_status,
        }),
    );

    // The event loop runs inside an async block so that *every* way it can end
    // — a clean close, a remote disconnect, or a `?` error — funnels through the
    // forward-drain below before this function returns and the tokio runtime is
    // torn down. See `forward_tasks` for why draining in-context matters.
    let outcome: Result<TerminalRunOutcome, String> = async {
        loop {
        tokio::select! {
            control = control_rx.recv() => {
                match control {
                    Some(SshTerminalControl::Input(data)) => {
                        let bytes = data.len();
                        ssh_debug(
                            "terminal.input.write_begin",
                            json!({
                                "sessionId": request.session_id,
                                "bytes": bytes,
                            }),
                        );
                        channel
                            .data(&data[..])
                            .await
                            .map_err(|error| {
                                ssh_debug(
                                    "terminal.input.write_error",
                                    json!({
                                        "sessionId": request.session_id,
                                        "bytes": bytes,
                                        "error": error.to_string(),
                                    }),
                                );
                                format!("failed to write SSH terminal input: {error}")
                            })?;
                        ssh_debug(
                            "terminal.input.write_ok",
                            json!({
                                "sessionId": request.session_id,
                                "bytes": bytes,
                            }),
                        );
                    }
                    Some(SshTerminalControl::Resize {
                        cols,
                        pixel_height,
                        pixel_width,
                        rows,
                    }) => {
                        ssh_debug(
                            "terminal.resize",
                            json!({
                                "sessionId": request.session_id,
                                "cols": cols,
                                "rows": rows,
                                "pixelWidth": pixel_width,
                                "pixelHeight": pixel_height,
                            }),
                        );
                        channel
                            .window_change(
                                cols.into(),
                                rows.into(),
                                pixel_width.into(),
                                pixel_height.into(),
                            )
                            .await
                            .map_err(|error| format!("failed to resize SSH terminal: {error}"))?;
                    }
                    Some(SshTerminalControl::Close) | None => {
                        ssh_debug(
                            "terminal.control.close",
                            json!({
                                "sessionId": request.session_id,
                                "controlChannelClosed": control_rx.is_closed(),
                            }),
                        );
                        let _ = channel.eof().await;
                        let _ = channel.close().await;
                        let _ = disconnect_ssh_session(&session, "").await;
                        return Ok(TerminalRunOutcome::Closed);
                    }
                }
            }
            worker_message = worker_rx.recv() => {
                match worker_message {
                    Some(NativeSshWorkerMsg::Command { command, reply }) => {
                        // Run the probe on its own exec channel concurrently with the
                        // shell so terminal I/O is never blocked. The shared Session
                        // handle reuses the authenticated transport, so no second
                        // connection (and no system `ssh` window) is needed.
                        let session = Rc::clone(&session);
                        tokio::task::spawn_local(async move {
                            let result = match tokio::time::timeout(
                                SSH_COMMAND_TIMEOUT,
                                exec_collect_on_session(&session, command),
                            )
                            .await
                            {
                                Ok(result) => result,
                                Err(_) => Err("SSH command timed out".to_string()),
                            };
                            let _ = reply.send(result);
                        });
                    }
                    Some(NativeSshWorkerMsg::StartPortForward {
                        forward_id,
                        kind,
                        reply,
                    }) => {
                        if let Some(existing) = live_port_forwards.remove(&forward_id) {
                            stop_live_port_forward(existing, &session, &remote_forward_targets).await;
                        }
                        let result = match kind {
                            NativeSshPortForwardKind::Local { listener, dest_host, dest_port } => {
                                TcpListener::from_std(listener)
                                    .map_err(|error| format!("failed to start local port forward listener: {error}"))
                                    .map(|listener| {
                                        let (stop_tx, stop_rx) = oneshot::channel();
                                        let session = Rc::clone(&session);
                                        let task_forward_id = forward_id.clone();
                                        ssh_debug(
                                            "portforward.local.started",
                                            json!({
                                                "forwardId": task_forward_id,
                                                "destPort": dest_port,
                                            }),
                                        );
                                        forward_tasks.spawn_local(async move {
                                            if let Err(error) = run_live_ssh_port_forward(listener, session, dest_host, dest_port, stop_rx).await {
                                                ssh_debug(
                                                    "portforward.local.stopped",
                                                    json!({ "forwardId": task_forward_id, "error": error }),
                                                );
                                            }
                                        });
                                        LivePortForward::Listener(stop_tx)
                                    })
                            }
                            NativeSshPortForwardKind::Dynamic { listener } => {
                                TcpListener::from_std(listener)
                                    .map_err(|error| format!("failed to start dynamic port forward listener: {error}"))
                                    .map(|listener| {
                                        let (stop_tx, stop_rx) = oneshot::channel();
                                        let session = Rc::clone(&session);
                                        let task_forward_id = forward_id.clone();
                                        ssh_debug(
                                            "portforward.dynamic.started",
                                            json!({ "forwardId": task_forward_id }),
                                        );
                                        forward_tasks.spawn_local(async move {
                                            if let Err(error) = run_live_ssh_dynamic_forward(listener, session, stop_rx).await {
                                                ssh_debug(
                                                    "portforward.dynamic.stopped",
                                                    json!({ "forwardId": task_forward_id, "error": error }),
                                                );
                                            }
                                        });
                                        LivePortForward::Listener(stop_tx)
                                    })
                            }
                            NativeSshPortForwardKind::Remote { bind, listen_port, dest_host, dest_port } => {
                                let port = u32::from(listen_port);
                                if let Ok(mut targets) = remote_forward_targets.lock() {
                                    targets.insert((bind.clone(), port), (dest_host, dest_port));
                                }
                                match session.tcpip_forward(bind.clone(), u32::from(listen_port)).await {
                                    Ok(allocated_port) => {
                                        let actual_port = if listen_port == 0 { allocated_port } else { port };
                                        if actual_port != port {
                                            if let Ok(mut targets) = remote_forward_targets.lock() {
                                                if let Some(target) = targets.remove(&(bind.clone(), port)) {
                                                    targets.insert((bind.clone(), actual_port), target);
                                                }
                                            }
                                        }
                                        Ok(LivePortForward::Remote { bind, port: actual_port })
                                    }
                                    Err(error) => {
                                        if let Ok(mut targets) = remote_forward_targets.lock() {
                                            targets.remove(&(bind, port));
                                        }
                                        Err(format!("failed to start remote port forward listener: {error}"))
                                    },
                                }
                            }
                        };
                        match result {
                            Ok(live_forward) => {
                                live_port_forwards.insert(forward_id, live_forward);
                                let _ = reply.send(Ok(()));
                            }
                            Err(error) => { let _ = reply.send(Err(error)); }
                        }
                    }
                    Some(NativeSshWorkerMsg::StopPortForward { forward_id }) => {
                        if let Some(existing) = live_port_forwards.remove(&forward_id) {
                            stop_live_port_forward(existing, &session, &remote_forward_targets).await;
                        }
                    }
                    None => {}
                }
            }
            message = channel.wait() => {
                match message {
                    Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                        ssh_debug(
                            "terminal.output",
                            json!({
                                "sessionId": request.session_id,
                                "bytes": data.len(),
                            }),
                        );
                        emit_terminal_output(
                            &app,
                            &request.session_id,
                            String::from_utf8_lossy(&data).to_string(),
                        );
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        ssh_debug(
                            "terminal.channel.closed",
                            json!({
                                "sessionId": request.session_id,
                                "message": match message {
                                    Some(ChannelMsg::Eof) => "eof",
                                    Some(ChannelMsg::Close) => "close",
                                    None => "none",
                                    _ => "other",
                                },
                            }),
                        );
                        let _ = disconnect_ssh_session(&session, "").await;
                        return Ok(TerminalRunOutcome::Disconnected);
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        ssh_debug(
                            "terminal.channel.exit_status",
                            json!({
                                "sessionId": request.session_id,
                                "exitStatus": exit_status,
                            }),
                        );
                    }
                    Some(ChannelMsg::ExitSignal {
                        signal_name,
                        core_dumped,
                        error_message,
                        lang_tag,
                    }) => {
                        ssh_debug(
                            "terminal.channel.exit_signal",
                            json!({
                                "sessionId": request.session_id,
                                "signalName": format!("{:?}", signal_name),
                                "coreDumped": core_dumped,
                                "errorMessage": error_message,
                                "languageTag": lang_tag,
                            }),
                        );
                    }
                    Some(ChannelMsg::Success) => {
                        ssh_debug(
                            "terminal.channel.request_success",
                            json!({
                                "sessionId": request.session_id,
                            }),
                        );
                    }
                    Some(ChannelMsg::Failure) => {
                        ssh_debug(
                            "terminal.channel.request_failure",
                            json!({
                                "sessionId": request.session_id,
                            }),
                        );
                    }
                    Some(ChannelMsg::OpenFailure(reason)) => {
                        ssh_debug(
                            "terminal.channel.open_failure",
                            json!({
                                "sessionId": request.session_id,
                                "reason": format!("{:?}", reason),
                            }),
                        );
                    }
                    _ => {}
                }
            }
        }
        }
    }
    .await;

    shutdown_live_port_forwards(
        &mut live_port_forwards,
        &mut forward_tasks,
        &bridge_tasks,
        &session,
        &remote_forward_targets,
    )
    .await;

    outcome
}

fn can_resume_tmux_terminal(request: &NativeSshTerminalRequest) -> bool {
    request.use_tmux
        && request
            .tmux_session_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|session_id| !session_id.is_empty())
}

pub(crate) async fn disconnect_ssh_session(
    session: &client::Handle<VerifyingClient>,
    reason: &str,
) -> Result<(), String> {
    match session
        .disconnect(Disconnect::ByApplication, reason, "en")
        .await
    {
        Ok(()) => Ok(()),
        Err(error) if is_benign_ssh_disconnect_error(&error) => Ok(()),
        Err(error) => Err(format!("failed to disconnect SSH session: {error}")),
    }
}

fn is_benign_ssh_disconnect_error(error: &russh::Error) -> bool {
    matches!(
        error,
        russh::Error::SendError | russh::Error::HUP | russh::Error::Disconnect
    )
}

fn emit_terminal_output(app: &AppHandle, session_id: &str, data: String) {
    crate::sessions::emit_terminal_output(app, session_id, data);
}

fn initial_directory_for(request: &NativeSshTerminalRequest) -> Option<String> {
    request
        .initial_directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty() && *directory != "~")
        .map(str::to_string)
}

fn startup_command_for(request: &NativeSshTerminalRequest) -> Option<String> {
    if request.use_tmux {
        return request
            .tmux_session_id
            .as_deref()
            .map(str::trim)
            .filter(|session_id| !session_id.is_empty())
            .map(|session_id| {
                remote_tmux_resume_command(
                    initial_directory_for(request).as_deref(),
                    session_id,
                    request.tmux_history_limit,
                )
            });
    }

    initial_directory_for(request)
        .map(|directory| format!("cd -- {}", shell_single_quote(&directory)))
}

pub(crate) fn remote_tmux_resume_command(
    initial_directory: Option<&str>,
    session_id: &str,
    history_limit: u32,
) -> String {
    let cd_command = initial_directory
        .map(|directory| format!("cd -- {} && ", shell_single_quote(directory)))
        .unwrap_or_default();
    let session = shell_single_quote(session_id);
    let history_limit = clamp_tmux_history_limit(history_limit);
    format!(
        // The marker printfs build their bracketed text from a printf %s argument on
        // purpose: the command is typed into the remote PTY, which echoes it back, and
        // the frontend reacts when it sees a marker in terminal output. Keeping the
        // bracketed markers out of the literal command source means only a genuine
        // runtime branch emits them.
        //
        // Before attaching we probe `tmux has-session` so the host authoritatively
        // reports whether `new-session -A` will create the session or attach to an
        // existing one. The frontend reads the "tmux session created" / "tmux session
        // attached" markers to decide whether to replay the connection's startup
        // script (new sessions always; existing sessions only when the user opts in).
        // tmux's alternate screen redraw wipes the marker line on attach, so it never
        // lingers in view or in the pane's scrollback.
        "if command -v tmux >/dev/null 2>&1; then \
            if tmux has-session -t {session} 2>/dev/null; then \
                printf '\\r\\n[%s]\\r\\n' 'KKTerm: tmux session attached'; \
            else \
                printf '\\r\\n[%s]\\r\\n' 'KKTerm: tmux session created'; \
            fi; \
            {cd_command}exec tmux new-session -A -s {session} \\; set-option mouse on \\; set-option set-clipboard on \\; set-option history-limit {history_limit}; \
        else \
            {cd_command}printf '\\r\\n[%s]\\r\\n' 'KKTerm: tmux not found, using normal shell'; exec \"${{SHELL:-sh}}\" -i; \
        fi",
    )
}

fn clamp_tmux_history_limit(value: u32) -> u32 {
    value.clamp(100, 100_000)
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[derive(Debug, PartialEq, Eq)]
enum HostKeyTrustStatus {
    Trusted,
    Unknown,
    Changed { line: usize },
}

impl HostKeyTrustStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Trusted => "trusted",
            Self::Unknown => "unknown",
            Self::Changed { .. } => "changed",
        }
    }
}

fn host_key_status(
    host: &str,
    port: u16,
    key: &russh::keys::ssh_key::PublicKey,
    known_hosts_path: &PathBuf,
) -> Result<HostKeyTrustStatus, String> {
    match russh::keys::known_hosts::check_known_hosts_path(host, port, key, known_hosts_path) {
        Ok(true) => Ok(HostKeyTrustStatus::Trusted),
        Ok(false) => Ok(HostKeyTrustStatus::Unknown),
        Err(russh::keys::Error::KeyChanged { line }) => Ok(HostKeyTrustStatus::Changed { line }),
        Err(error) => Err(format!("failed to check SSH known hosts: {error}")),
    }
}

fn host_key_fingerprint(key: &russh::keys::ssh_key::PublicKey) -> String {
    key.fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
        .to_string()
}

fn required_host(host: String) -> Result<String, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        Err("host is required for SSH host-key verification".to_string())
    } else {
        Ok(host)
    }
}

fn remember_rejection(rejection: &Arc<std::sync::Mutex<Option<String>>>, message: String) {
    if let Ok(mut rejection) = rejection.lock() {
        *rejection = Some(message);
    }
}

fn remembered_rejection(rejection: &Arc<std::sync::Mutex<Option<String>>>) -> Option<String> {
    rejection.lock().ok().and_then(|message| message.clone())
}

fn normalize_native_ssh_auth(auth: NativeSshAuth) -> Result<NativeSshAuth, String> {
    match auth {
        NativeSshAuth::KeyFile {
            key_path,
            passphrase,
        } => {
            let key_path = key_path.trim().to_string();
            if key_path.is_empty() {
                Err("key path is required for SSH key-file authentication".to_string())
            } else {
                Ok(NativeSshAuth::KeyFile {
                    key_path,
                    passphrase: passphrase.and_then(|value| (!value.is_empty()).then_some(value)),
                })
            }
        }
        NativeSshAuth::Password { password } => Ok(NativeSshAuth::Password {
            password: password.and_then(|password| {
                let password = password.trim().to_string();
                (!password.is_empty()).then_some(password)
            }),
        }),
        NativeSshAuth::Agent => Ok(NativeSshAuth::Agent),
    }
}

struct TerminalAuthPrompt<'a> {
    app: &'a AppHandle,
    session_id: &'a str,
    control_rx: &'a mut mpsc::UnboundedReceiver<SshTerminalControl>,
}

pub(crate) async fn connect_verified_client(
    request: NativeSshConnectionRequest,
) -> Result<client::Handle<VerifyingClient>, String> {
    connect_verified_client_with_prompt(request, None).await
}

async fn connect_verified_client_with_prompt(
    request: NativeSshConnectionRequest,
    mut prompt: Option<&mut TerminalAuthPrompt<'_>>,
) -> Result<client::Handle<VerifyingClient>, String> {
    let host = request.host.trim();
    if host.is_empty() {
        return Err("host is required for native SSH sessions".to_string());
    }

    let user = request.user.trim();
    if user.is_empty() {
        return Err("user is required for native SSH sessions".to_string());
    }

    let auth = normalize_native_ssh_auth(request.auth)?;
    let config = Arc::new(native_ssh_client_config(request.compression));
    let host_key_rejection = Arc::new(std::sync::Mutex::new(None));
    let socks_proxy = request
        .socks_proxy
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    ssh_debug(
        "connection.start",
        json!({
            "host": host,
            "port": request.port,
            "user": user,
            "authMethod": auth_method_name(&auth),
            "socksProxyConfigured": socks_proxy.is_some(),
            "socksProxyEndpoint": socks_proxy.as_deref().and_then(socks_proxy_endpoint_for_log),
            "keepaliveIntervalMs": SSH_KEEPALIVE_INTERVAL.as_millis(),
            "keepaliveMaxMissed": SSH_KEEPALIVE_MAX_MISSED,
        }),
    );
    let verifying = VerifyingClient {
        host: host.to_string(),
        port: request.port,
        known_hosts_path: request.known_hosts_path,
        rejection: Arc::clone(&host_key_rejection),
        x11_forwarding: request.x11_forwarding,
        remote_forward_targets: request.remote_forward_targets,
        bridge_tasks: request.bridge_tasks,
    };
    let mut session = with_ssh_startup_timeout("connecting to SSH server", async {
        match socks_proxy.as_deref() {
            Some(proxy) => {
                ssh_debug(
                    "connection.socks.connect_begin",
                    json!({
                        "host": host,
                        "port": request.port,
                        "socksProxyEndpoint": socks_proxy_endpoint_for_log(proxy),
                    }),
                );
                let stream = crate::socks::connect_via_socks5(proxy, host, request.port).await?;
                ssh_debug(
                    "connection.socks.connect_ok",
                    json!({
                        "host": host,
                        "port": request.port,
                        "socksProxyEndpoint": socks_proxy_endpoint_for_log(proxy),
                    }),
                );
                client::connect_stream(config, stream, verifying)
                    .await
                    .map_err(|error| format!("failed to connect to SSH server: {error}"))
            }
            None => client::connect(config, (host, request.port), verifying)
                .await
                .map_err(|error| {
                    remembered_rejection(&host_key_rejection)
                        .unwrap_or_else(|| format!("failed to connect to SSH server: {error}"))
                }),
        }
    })
    .await?;

    ssh_debug(
        "connection.ssh.connected",
        json!({
            "host": host,
            "port": request.port,
            "user": user,
            "socksProxyConfigured": socks_proxy.is_some(),
        }),
    );
    authenticate_native_ssh(&mut session, user, &auth, prompt.as_deref_mut()).await?;
    ssh_debug(
        "connection.authenticated",
        json!({
            "host": host,
            "port": request.port,
            "user": user,
            "authMethod": auth_method_name(&auth),
        }),
    );
    Ok(session)
}

fn x11_port(display: u16) -> u16 {
    6000 + display.min(99)
}

/// Spawns a server-initiated bridge task (X11 or remote `-R`) into the shared
/// tracking set when one is provided, so the worker can drain it on teardown
/// while the runtime is still alive; otherwise falls back to a detached spawn.
fn spawn_bridge_task<F>(bridge_tasks: &Option<SshBridgeTasks>, task: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    match bridge_tasks.as_ref().and_then(|tasks| tasks.lock().ok()) {
        Some(mut tasks) => {
            tasks.spawn(task);
        }
        // No tracking set, or a poisoned lock (only ever held briefly): fall
        // back to a detached task so the bridge still functions.
        None => {
            tokio::spawn(task);
        }
    }
}

async fn bridge_x11_channel(channel: Channel<Msg>, display: u16) -> Result<(), String> {
    let mut remote = channel.into_stream();
    let mut local = TcpStream::connect(("127.0.0.1", x11_port(display)))
        .await
        .map_err(|error| format!("failed to connect to local X server: {error}"))?;
    copy_bidirectional(&mut remote, &mut local)
        .await
        .map_err(|error| format!("failed to proxy X11 data: {error}"))?;
    Ok(())
}

async fn run_live_ssh_port_forward(
    listener: TcpListener,
    session: Rc<client::Handle<VerifyingClient>>,
    dest_host: String,
    remote_port: u16,
    mut stop_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    // Per-connection forward tasks are tracked here (instead of being detached
    // with a bare `spawn_local`) so that when the listener stops we can drain
    // them while the tokio runtime is still being driven. russh closes a
    // forwarded channel from its `Drop` impl via `tokio::spawn`, which panics
    // if the runtime is already gone — historically (`panic = "abort"`) that
    // crashed the whole app. scrcpy keeps several forwarded channels live at
    // all times, so it hit this on every teardown unless we drain in-context.
    let mut connections: JoinSet<()> = JoinSet::new();
    let result = loop {
        tokio::select! {
            _ = &mut stop_rx => break Ok(()),
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, originator)) => {
                        // Reap finished connections so a long-lived forward
                        // (scrcpy makes many short adb connections) does not
                        // accumulate join handles. `try_join_next` is sync, so
                        // it avoids borrowing `connections` across the select.
                        while connections.try_join_next().is_some() {}
                        let session = Rc::clone(&session);
                        let dest_host = dest_host.clone();
                        connections.spawn_local(async move {
                            if let Err(error) = forward_live_ssh_stream(
                                stream,
                                originator,
                                session,
                                dest_host,
                                remote_port,
                            )
                            .await
                            {
                                ssh_debug(
                                    "portforward.local.connection_error",
                                    json!({ "error": error }),
                                );
                            }
                        });
                    }
                    Err(error) => {
                        break Err(format!(
                            "failed to accept local port forward connection: {error}"
                        ));
                    }
                }
            }
        }
    };
    // Close in-flight forwarded channels while the runtime is still alive.
    connections.shutdown().await;
    result
}

async fn forward_live_ssh_stream(
    mut local: TcpStream,
    originator: SocketAddr,
    session: Rc<client::Handle<VerifyingClient>>,
    dest_host: String,
    remote_port: u16,
) -> Result<(), String> {
    let channel = session
        .channel_open_direct_tcpip(
            dest_host,
            u32::from(remote_port),
            originator.ip().to_string(),
            u32::from(originator.port()),
        )
        .await
        .map_err(|error| format!("failed to open SSH direct-tcpip channel: {error}"))?;
    let mut remote = channel.into_stream();
    copy_bidirectional(&mut local, &mut remote)
        .await
        .map_err(|error| format!("failed to proxy SSH port forward data: {error}"))?;
    Ok(())
}

async fn run_live_ssh_dynamic_forward(
    listener: TcpListener,
    session: Rc<client::Handle<VerifyingClient>>,
    mut stop_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    // See `run_live_ssh_port_forward` for why per-connection tasks are tracked
    // and drained rather than detached.
    let mut connections: JoinSet<()> = JoinSet::new();
    let result = loop {
        tokio::select! {
            _ = &mut stop_rx => break Ok(()),
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, originator)) => {
                        while connections.try_join_next().is_some() {}
                        let session = Rc::clone(&session);
                        connections.spawn_local(async move {
                            if let Err(error) =
                                forward_live_ssh_socks5_stream(stream, originator, session).await
                            {
                                ssh_debug(
                                    "portforward.dynamic.connection_error",
                                    json!({ "error": error }),
                                );
                            }
                        });
                    }
                    Err(error) => {
                        break Err(format!("failed to accept SOCKS5 connection: {error}"));
                    }
                }
            }
        }
    };
    connections.shutdown().await;
    result
}

async fn forward_live_ssh_socks5_stream(
    mut local: TcpStream,
    originator: SocketAddr,
    session: Rc<client::Handle<VerifyingClient>>,
) -> Result<(), String> {
    let mut greeting = [0_u8; 2];
    local
        .read_exact(&mut greeting)
        .await
        .map_err(|error| format!("failed to read SOCKS5 greeting: {error}"))?;
    if greeting[0] != 5 {
        return Err("SOCKS5 client used an unsupported protocol version".to_string());
    }
    let mut methods = vec![0_u8; usize::from(greeting[1])];
    local
        .read_exact(&mut methods)
        .await
        .map_err(|error| format!("failed to read SOCKS5 methods: {error}"))?;
    if !methods.contains(&0) {
        local
            .write_all(&[5, 0xff])
            .await
            .map_err(|error| format!("failed to reject SOCKS5 authentication: {error}"))?;
        return Err("SOCKS5 client did not offer no-authentication".to_string());
    }
    local
        .write_all(&[5, 0])
        .await
        .map_err(|error| format!("failed to accept SOCKS5 authentication: {error}"))?;

    let mut request = [0_u8; 4];
    local
        .read_exact(&mut request)
        .await
        .map_err(|error| format!("failed to read SOCKS5 request: {error}"))?;
    if request[0] != 5 || request[1] != 1 || request[2] != 0 {
        let _ = local.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]).await;
        return Err("SOCKS5 forwarding supports CONNECT requests only".to_string());
    }

    let mut encoded_target = vec![request[3]];
    match request[3] {
        1 => {
            let mut address = [0_u8; 4];
            local
                .read_exact(&mut address)
                .await
                .map_err(|error| format!("failed to read SOCKS5 IPv4 target: {error}"))?;
            encoded_target.extend_from_slice(&address);
        }
        3 => {
            let length = local
                .read_u8()
                .await
                .map_err(|error| format!("failed to read SOCKS5 host length: {error}"))?;
            encoded_target.push(length);
            let mut address = vec![0_u8; usize::from(length)];
            local
                .read_exact(&mut address)
                .await
                .map_err(|error| format!("failed to read SOCKS5 host: {error}"))?;
            encoded_target.extend_from_slice(&address);
        }
        4 => {
            let mut address = [0_u8; 16];
            local
                .read_exact(&mut address)
                .await
                .map_err(|error| format!("failed to read SOCKS5 IPv6 target: {error}"))?;
            encoded_target.extend_from_slice(&address);
        }
        _ => {
            let _ = local.write_all(&[5, 8, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            return Err("SOCKS5 client used an unsupported address type".to_string());
        }
    }
    let mut port = [0_u8; 2];
    local
        .read_exact(&mut port)
        .await
        .map_err(|error| format!("failed to read SOCKS5 target port: {error}"))?;
    encoded_target.extend_from_slice(&port);
    let (dest_host, dest_port) = parse_socks5_target(&encoded_target)?;

    let channel = match session
        .channel_open_direct_tcpip(
            dest_host,
            u32::from(dest_port),
            originator.ip().to_string(),
            u32::from(originator.port()),
        )
        .await
    {
        Ok(channel) => channel,
        Err(error) => {
            let _ = local.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await;
            return Err(format!(
                "failed to open SSH channel for SOCKS5 target: {error}"
            ));
        }
    };
    local
        .write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
        .await
        .map_err(|error| format!("failed to confirm SOCKS5 connection: {error}"))?;
    let mut remote = channel.into_stream();
    copy_bidirectional(&mut local, &mut remote)
        .await
        .map_err(|error| format!("failed to proxy SOCKS5 data: {error}"))?;
    Ok(())
}

fn parse_socks5_target(value: &[u8]) -> Result<(String, u16), String> {
    let (&address_type, rest) = value
        .split_first()
        .ok_or_else(|| "SOCKS5 target is empty".to_string())?;
    let (host, port_bytes) = match address_type {
        1 if rest.len() == 6 => (
            Ipv4Addr::new(rest[0], rest[1], rest[2], rest[3]).to_string(),
            &rest[4..],
        ),
        3 if !rest.is_empty() && rest[0] > 0 && rest.len() == usize::from(rest[0]) + 3 => {
            let end = usize::from(rest[0]) + 1;
            let host = std::str::from_utf8(&rest[1..end])
                .map_err(|_| "SOCKS5 host is not valid UTF-8".to_string())?
                .to_string();
            (host, &rest[end..])
        }
        4 if rest.len() == 18 => {
            let address: [u8; 16] = rest[..16]
                .try_into()
                .map_err(|_| "SOCKS5 IPv6 target is invalid".to_string())?;
            (Ipv6Addr::from(address).to_string(), &rest[16..])
        }
        1 | 3 | 4 => return Err("SOCKS5 target has an invalid length".to_string()),
        _ => return Err("SOCKS5 target uses an unsupported address type".to_string()),
    };
    Ok((host, u16::from_be_bytes([port_bytes[0], port_bytes[1]])))
}

async fn bridge_remote_forward_channel(
    channel: Channel<Msg>,
    dest_host: String,
    dest_port: u16,
) -> Result<(), String> {
    let mut local = TcpStream::connect((dest_host.as_str(), dest_port))
        .await
        .map_err(|error| format!("failed to connect to remote-forward destination: {error}"))?;
    let mut remote = channel.into_stream();
    copy_bidirectional(&mut local, &mut remote)
        .await
        .map_err(|error| format!("failed to proxy remote-forward data: {error}"))?;
    Ok(())
}

/// Tears down every live port forward on session teardown.
///
/// Each forward is asked to stop gracefully (which makes its listener task drain
/// the per-connection forward tasks it owns), then the listener tasks are drained
/// here. The whole drain runs while the tokio runtime is still being driven so
/// that russh can close the forwarded channels from its `Drop` impl — that `Drop`
/// calls `tokio::spawn`, which panics if the runtime is already gone. (The worker
/// also catches panics as a backstop, but draining avoids the panic entirely and
/// closes channels cleanly.) A bounded grace keeps a stuck connection from
/// hanging teardown; anything still alive afterwards is forced down with the
/// runtime still present.
async fn shutdown_live_port_forwards(
    live_port_forwards: &mut HashMap<String, LivePortForward>,
    forward_tasks: &mut JoinSet<()>,
    bridge_tasks: &SshBridgeTasks,
    session: &client::Handle<VerifyingClient>,
    remote_forward_targets: &RemoteForwardTargets,
) {
    let forward_count = live_port_forwards.len();
    // Take the server-initiated bridge tasks (X11, remote `-R`) out of the
    // shared set so we can await them without holding the lock across `.await`.
    let mut bridges = bridge_tasks
        .lock()
        .map(|mut guard| std::mem::take(&mut *guard))
        .unwrap_or_default();
    if forward_count == 0 && forward_tasks.is_empty() && bridges.is_empty() {
        return;
    }
    for (_, forward) in live_port_forwards.drain() {
        stop_live_port_forward(forward, session, remote_forward_targets).await;
    }
    // Drain the local/dynamic forward listeners (which drain their own
    // per-connection tasks) and the server-initiated bridges, all while the
    // runtime is still alive so russh can close each channel from its `Drop`.
    let forwards_graceful = drain_join_set_with_grace(forward_tasks).await;
    let bridges_graceful = drain_join_set_with_grace(&mut bridges).await;
    ssh_debug(
        "portforward.teardown",
        json!({
            "forwards": forward_count,
            "forwardsGraceful": forwards_graceful,
            "bridgesGraceful": bridges_graceful,
        }),
    );
}

/// Drains a `JoinSet` within a bounded grace period, then forces down any
/// stragglers. Both phases run while the tokio runtime is still being driven, so
/// dropping the tasks (and the SSH channel streams they own) cannot trigger the
/// "spawn with no runtime" panic in russh's channel `Drop`. Returns whether the
/// graceful phase finished before the grace elapsed.
async fn drain_join_set_with_grace(tasks: &mut JoinSet<()>) -> bool {
    if tasks.is_empty() {
        return true;
    }
    let graceful = tokio::time::timeout(SSH_FORWARD_SHUTDOWN_GRACE, async {
        while tasks.join_next().await.is_some() {}
    })
    .await
    .is_ok();
    if !graceful {
        tasks.shutdown().await;
    }
    graceful
}

async fn stop_live_port_forward(
    forward: LivePortForward,
    session: &client::Handle<VerifyingClient>,
    remote_forward_targets: &RemoteForwardTargets,
) {
    match forward {
        LivePortForward::Listener(stop) => {
            let _ = stop.send(());
        }
        LivePortForward::Remote { bind, port } => {
            let _ = session.cancel_tcpip_forward(bind.clone(), port).await;
            if let Ok(mut targets) = remote_forward_targets.lock() {
                targets.remove(&(bind, port));
            }
        }
    }
}

fn x11_auth_cookie() -> String {
    rand::random::<[u8; 16]>()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod ssh_port_forward_tests {
    use super::*;

    #[test]
    fn parses_socks5_ipv4_domain_and_ipv6_targets() {
        assert_eq!(
            parse_socks5_target(&[1, 127, 0, 0, 1, 0x01, 0xbb]).unwrap(),
            ("127.0.0.1".to_string(), 443)
        );
        assert_eq!(
            parse_socks5_target(&[
                3, 11, b'e', b'x', b'a', b'm', b'p', b'l', b'e', b'.', b'c', b'o', b'm', 0, 80
            ])
            .unwrap(),
            ("example.com".to_string(), 80)
        );
        assert_eq!(
            parse_socks5_target(&[
                4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0x20, 0xfb
            ])
            .unwrap(),
            ("::1".to_string(), 8443)
        );
    }

    #[test]
    fn rejects_invalid_socks5_targets() {
        assert!(parse_socks5_target(&[]).is_err());
        assert!(parse_socks5_target(&[3, 0, 0, 80]).is_err());
        assert!(parse_socks5_target(&[9, 127, 0, 0, 1, 0, 80]).is_err());
    }
}

fn native_ssh_client_config(compression: bool) -> client::Config {
    client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(SSH_KEEPALIVE_INTERVAL),
        keepalive_max: SSH_KEEPALIVE_MAX_MISSED,
        preferred: native_ssh_preferred_algorithms(compression),
        ..Default::default()
    }
}

// russh 0.60's `Preferred::DEFAULT` (and `COMPRESSED`) list `none` first in the
// compression order, so negotiation always settles on `none` even though the
// `flate2` feature compiles zlib in. That makes KKTerm behave like `ssh -X`
// (no compression) rather than `ssh -XC`. When compression is requested we put
// zlib ahead of `none` — mirroring OpenSSH's `-C` (`zlib@openssh.com,zlib,none`)
// — so the transport actually compresses. `zlib@openssh.com` defers compression
// until after authentication; russh handles that activation correctly. `none`
// stays last as a fallback for servers that refuse compression.
fn native_ssh_preferred_algorithms(compression: bool) -> russh::Preferred {
    if !compression {
        return russh::Preferred::DEFAULT;
    }
    russh::Preferred {
        compression: std::borrow::Cow::Borrowed(&[
            russh::compression::ZLIB_LEGACY,
            russh::compression::ZLIB,
            russh::compression::NONE,
        ]),
        ..russh::Preferred::DEFAULT
    }
}

async fn with_ssh_startup_timeout<T, F>(operation: &'static str, future: F) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    with_ssh_startup_timeout_duration(operation, SSH_STARTUP_TIMEOUT, future).await
}

async fn with_ssh_startup_timeout_duration<T, F>(
    operation: &'static str,
    timeout: Duration,
    future: F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| format!("timed out while {operation}"))?
}

async fn authenticate_native_ssh(
    session: &mut client::Handle<VerifyingClient>,
    user: &str,
    auth: &NativeSshAuth,
    prompt: Option<&mut TerminalAuthPrompt<'_>>,
) -> Result<(), String> {
    let mut prompt = prompt;
    let auth_result = match auth {
        NativeSshAuth::KeyFile {
            key_path,
            passphrase,
        } => {
            let key_result = load_secret_key(key_path, passphrase.as_deref()).or_else(|error| {
                if passphrase.is_some() {
                    load_secret_key(key_path, None)
                } else {
                    Err(error)
                }
            });
            let key_pair = match key_result {
                Ok(key_pair) => key_pair,
                Err(error)
                    if prompt.is_some()
                        && should_prompt_for_key_passphrase(&error.to_string(), passphrase.is_some()) =>
                {
                    let prompt = prompt.as_deref_mut().expect("prompt checked above");
                    let entered = read_terminal_prompt(prompt, "SSH key passphrase: ", false).await?;
                    load_secret_key(key_path, Some(&entered))
                        .map_err(|error| format!("failed to decrypt SSH key: {error}"))?
                }
                Err(error) => return Err(format!("failed to load SSH key: {error}")),
            };
            session
                .authenticate_publickey(
                    user.to_string(),
                    PrivateKeyWithHashAlg::new(
                        Arc::new(key_pair),
                        session
                            .best_supported_rsa_hash()
                            .await
                            .map_err(|error| {
                                format!("failed to negotiate SSH key algorithm: {error}")
                            })?
                            .flatten(),
                    ),
                )
                .await
                .map_err(|error| format!("SSH key-file authentication failed: {error}"))?
        }
        NativeSshAuth::Password {
            password: Some(password),
        } => session
            .authenticate_password(user.to_string(), password.clone())
            .await
            .map_err(|error| format!("SSH password authentication failed: {error}"))?,
        NativeSshAuth::Password { password: None } => {
            let prompt = prompt
                .as_deref_mut()
                .ok_or_else(|| "password is required for native SSH sessions".to_string())?;
            match authenticate_keyboard_interactive_from_terminal(session, user, prompt).await? {
                TerminalAuthOutcome::Success => return Ok(()),
                TerminalAuthOutcome::Rejected => {
                    let password = read_terminal_prompt(prompt, "Password: ", false).await?;
                    session
                        .authenticate_password(user.to_string(), password)
                        .await
                        .map_err(|error| format!("SSH password authentication failed: {error}"))?
                }
            }
        }
        NativeSshAuth::Agent => {
            authenticate_with_agent(session, user).await?;
            return Ok(());
        }
    };

    if !auth_result.success() {
        let method = match auth {
            NativeSshAuth::KeyFile { .. } => "key-file",
            NativeSshAuth::Password { .. } => "password",
            NativeSshAuth::Agent => "agent",
        };
        return Err(format!("SSH {method} authentication was rejected"));
    }

    Ok(())
}

fn should_prompt_for_key_passphrase(error: &str, had_saved_passphrase: bool) -> bool {
    let normalized = error.to_lowercase();
    had_saved_passphrase || normalized.contains("encrypt") || normalized.contains("decrypt")
}

enum TerminalAuthOutcome {
    Success,
    Rejected,
}

async fn authenticate_keyboard_interactive_from_terminal(
    session: &mut client::Handle<VerifyingClient>,
    user: &str,
    prompt: &mut TerminalAuthPrompt<'_>,
) -> Result<TerminalAuthOutcome, String> {
    let mut response = session
        .authenticate_keyboard_interactive_start(user.to_string(), None::<String>)
        .await
        .map_err(|error| format!("SSH keyboard-interactive authentication failed: {error}"))?;

    loop {
        match response {
            client::KeyboardInteractiveAuthResponse::Success => {
                return Ok(TerminalAuthOutcome::Success);
            }
            client::KeyboardInteractiveAuthResponse::Failure { .. } => {
                return Ok(TerminalAuthOutcome::Rejected);
            }
            client::KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                emit_auth_text(prompt, name);
                emit_auth_text(prompt, instructions);
                let mut responses = Vec::with_capacity(prompts.len());
                for server_prompt in prompts {
                    responses.push(
                        read_terminal_prompt(prompt, &server_prompt.prompt, server_prompt.echo)
                            .await?,
                    );
                }
                response = session
                    .authenticate_keyboard_interactive_respond(responses)
                    .await
                    .map_err(|error| {
                        format!("SSH keyboard-interactive authentication failed: {error}")
                    })?;
            }
        }
    }
}

fn emit_auth_text(prompt: &TerminalAuthPrompt<'_>, text: String) {
    let text = text.trim();
    if !text.is_empty() {
        emit_terminal_output(prompt.app, prompt.session_id, format!("{text}\r\n"));
    }
}

async fn read_terminal_prompt(
    prompt: &mut TerminalAuthPrompt<'_>,
    label: &str,
    echo: bool,
) -> Result<String, String> {
    emit_terminal_output(prompt.app, prompt.session_id, label.to_string());
    let mut input = Vec::new();
    while let Some(control) = prompt.control_rx.recv().await {
        match control {
            SshTerminalControl::Input(data) => {
                for byte in data {
                    match byte {
                        b'\r' | b'\n' => {
                            emit_terminal_output(prompt.app, prompt.session_id, "\r\n".to_string());
                            return Ok(String::from_utf8_lossy(&input).into_owned());
                        }
                        0x03 => {
                            emit_terminal_output(
                                prompt.app,
                                prompt.session_id,
                                "^C\r\n".to_string(),
                            );
                            return Err("SSH password prompt was cancelled".to_string());
                        }
                        0x08 | 0x7f => {
                            if input.pop().is_some() && echo {
                                emit_terminal_output(
                                    prompt.app,
                                    prompt.session_id,
                                    "\x08 \x08".to_string(),
                                );
                            }
                        }
                        _ => {
                            input.push(byte);
                            if echo {
                                emit_terminal_output(
                                    prompt.app,
                                    prompt.session_id,
                                    String::from_utf8_lossy(&[byte]).into_owned(),
                                );
                            }
                        }
                    }
                }
            }
            SshTerminalControl::Resize { .. } => {}
            SshTerminalControl::Close => {
                return Err("SSH password prompt was cancelled".to_string());
            }
        }
    }
    Err("SSH password prompt was cancelled".to_string())
}

async fn authenticate_with_agent(
    session: &mut client::Handle<VerifyingClient>,
    user: &str,
) -> Result<(), String> {
    let rsa_hash = session
        .best_supported_rsa_hash()
        .await
        .map_err(|error| format!("failed to negotiate SSH agent key algorithm: {error}"))?
        .flatten();

    let mut agents = connect_ssh_agents().await?;
    let mut failures = Vec::new();
    for agent in &mut agents {
        let identities = match request_agent_identities(agent).await {
            Ok(identities) => identities,
            Err(error) => {
                failures.push(error);
                continue;
            }
        };
        if identities.is_empty() {
            failures.push(format!("{} has no identities loaded", agent.source));
            continue;
        }

        for identity in identities {
            let auth_result = match identity {
                AgentIdentity::PublicKey { key, comment } => session
                    .authenticate_publickey_with(user.to_string(), key, rsa_hash, &mut agent.client)
                    .await
                    .map_err(|error| {
                        format!(
                            "{} authentication failed for {comment}: {error}",
                            agent.source
                        )
                    })?,
                AgentIdentity::Certificate {
                    certificate,
                    comment,
                } => session
                    .authenticate_certificate_with(
                        user.to_string(),
                        certificate,
                        rsa_hash,
                        &mut agent.client,
                    )
                    .await
                    .map_err(|error| {
                        format!(
                            "{} certificate authentication failed for {comment}: {error}",
                            agent.source
                        )
                    })?,
            };

            if auth_result.success() {
                return Ok(());
            }
            failures.push(format!("{} identity was rejected", agent.source));
        }
    }

    Err(if failures.is_empty() {
        "SSH agent authentication was rejected".to_string()
    } else {
        format!(
            "SSH agent authentication was unavailable: {}",
            failures.join("; ")
        )
    })
}

type DynamicAgentClient =
    AgentClient<Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin + 'static>>;

struct SshAgent {
    source: &'static str,
    client: DynamicAgentClient,
}

async fn request_agent_identities(agent: &mut SshAgent) -> Result<Vec<AgentIdentity>, String> {
    agent.client.request_identities().await.map_err(|error| {
        format!(
            "{} failed to list SSH agent identities: {error}",
            agent.source
        )
    })
}

#[cfg(unix)]
async fn connect_ssh_agents() -> Result<Vec<SshAgent>, String> {
    AgentClient::connect_env()
        .await
        .map(|agent| {
            vec![SshAgent {
                source: "SSH_AUTH_SOCK agent",
                client: agent.dynamic(),
            }]
        })
        .map_err(|error| format!("failed to connect to SSH agent from SSH_AUTH_SOCK: {error}"))
}

#[cfg(windows)]
async fn connect_ssh_agents() -> Result<Vec<SshAgent>, String> {
    let mut agents = Vec::new();
    let mut failures = Vec::new();

    match AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
        Ok(agent) => agents.push(SshAgent {
            source: "Windows OpenSSH agent",
            client: agent.dynamic(),
        }),
        Err(error) => failures.push(format!("Windows OpenSSH agent: {error}")),
    }

    match AgentClient::connect_pageant().await {
        Ok(agent) => agents.push(SshAgent {
            source: "Pageant agent",
            client: agent.dynamic(),
        }),
        Err(error) => failures.push(format!("Pageant agent: {error}")),
    }

    if agents.is_empty() {
        Err(format!(
            "failed to connect to Windows SSH agents: {}",
            failures.join("; ")
        ))
    } else {
        Ok(agents)
    }
}

#[cfg(not(any(unix, windows)))]
async fn connect_ssh_agents() -> Result<Vec<SshAgent>, String> {
    Err("SSH agent authentication is not supported on this platform yet".to_string())
}

// ── IT Ops interactive Playbook transport ──
// Placed after the terminal startup path on purpose: it opens its own PTY shell,
// and `tests/ssh-x11-forwarding.test.mjs` asserts the *first* `.request_shell(`
// in this file (the terminal's) is still preceded by `.request_x11(`.

/// One interactive Playbook step resolved for the SSH transport: text typed into
/// the host's PTY shell plus an optional literal substring to wait for after.
pub(crate) struct PlaybookStepSpec {
    pub send: String,
    pub expect: Option<String>,
    pub timeout_seconds: Option<u64>,
}

/// Outcome of running a Playbook over one host's interactive shell. `ok` is true
/// only when every step's `expect` matched; `failure` describes the first step
/// that timed out. `output` is the full combined PTY transcript.
pub(crate) struct PlaybookOutcome {
    pub ok: bool,
    pub failure: Option<String>,
    pub output: String,
}

/// Largest expect search window kept while waiting, so a chatty step cannot grow
/// the buffer without bound. A literal `expect` longer than this cannot match.
const PLAYBOOK_EXPECT_WINDOW: usize = 64 * 1024;

/// Fallback per-step `expect` wait when neither the step nor the run supplies a
/// timeout. The Batch Run transport always passes one, so this is a safety net.
const PLAYBOOK_DEFAULT_STEP_TIMEOUT_SECONDS: u64 = 120;

/// Run an interactive Playbook on one host: open a single PTY shell, then for
/// each step type `send` and (when `expect` is set) wait until that substring
/// appears in the streamed output before advancing. Streams every output frame
/// to `on_chunk` for the live grid. `Err` is reserved for connect/transport
/// failures; a step that times out is a normal `Ok` with `ok == false`.
pub(crate) fn run_playbook_capture_streaming(
    request: NativeSshCommandRequest,
    steps: Vec<PlaybookStepSpec>,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> Result<PlaybookOutcome, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create native SSH playbook runtime: {error}"))?;
    let default_timeout = request
        .timeout_seconds
        .unwrap_or(PLAYBOOK_DEFAULT_STEP_TIMEOUT_SECONDS);
    runtime.block_on(run_playbook_async(request, steps, default_timeout, on_chunk))
}

async fn run_playbook_async(
    request: NativeSshCommandRequest,
    steps: Vec<PlaybookStepSpec>,
    default_timeout_seconds: u64,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> Result<PlaybookOutcome, String> {
    let session = connect_verified_client(NativeSshConnectionRequest {
        host: request.host,
        user: request.user,
        port: request.port,
        auth: request.auth,
        known_hosts_path: request.known_hosts_path,
        x11_forwarding: None,
        socks_proxy: request.socks_proxy,
        compression: true,
        remote_forward_targets: None,
        bridge_tasks: None,
    })
    .await?;

    let outcome =
        run_playbook_on_session(&session, &steps, default_timeout_seconds, on_chunk).await;
    disconnect_ssh_session(&session, "playbook completed").await?;
    outcome
}

async fn run_playbook_on_session(
    session: &client::Handle<VerifyingClient>,
    steps: &[PlaybookStepSpec],
    default_timeout_seconds: u64,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> Result<PlaybookOutcome, String> {
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|error| format!("failed to open SSH playbook channel: {error}"))?;
    channel
        .request_pty(false, "xterm-256color", 120, 40, 0, 0, &[])
        .await
        .map_err(|error| format!("failed to allocate SSH PTY: {error}"))?;
    channel
        .request_shell(false)
        .await
        .map_err(|error| format!("failed to start SSH shell: {error}"))?;

    let mut output = String::new();
    for (index, step) in steps.iter().enumerate() {
        if !step.send.is_empty() {
            channel
                .data(format!("{}\r", step.send).as_bytes())
                .await
                .map_err(|error| format!("failed to send playbook step: {error}"))?;
        }
        let Some(pattern) = step.expect.as_deref().filter(|pattern| !pattern.is_empty()) else {
            continue;
        };
        let timeout =
            Duration::from_secs(step.timeout_seconds.unwrap_or(default_timeout_seconds));
        if !wait_for_substring(&mut channel, pattern, timeout, &mut output, on_chunk).await {
            return Ok(PlaybookOutcome {
                ok: false,
                failure: Some(format!(
                    "step {} timed out waiting for “{pattern}”",
                    index + 1
                )),
                output,
            });
        }
    }

    let _ = channel.eof().await;
    let _ = channel.close().await;
    Ok(PlaybookOutcome {
        ok: true,
        failure: None,
        output,
    })
}

/// Read output frames until `pattern` appears or `timeout` elapses, appending all
/// output to `transcript` and streaming it to `on_chunk`. Returns whether the
/// pattern matched; a channel that closes before a match counts as no match. A
/// sliding window bounds memory while still matching a pattern split across
/// frames.
async fn wait_for_substring(
    channel: &mut Channel<Msg>,
    pattern: &str,
    timeout: Duration,
    transcript: &mut String,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> bool {
    let deadline = Instant::now() + timeout;
    let mut window = String::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return false;
        }
        match tokio::time::timeout(remaining, channel.wait()).await {
            Err(_) => return false,
            Ok(None) => return false,
            Ok(Some(message)) => match message {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    let text = String::from_utf8_lossy(&data);
                    on_chunk(&text);
                    transcript.push_str(&text);
                    window.push_str(&text);
                    if window.contains(pattern) {
                        return true;
                    }
                    if window.len() > PLAYBOOK_EXPECT_WINDOW {
                        let target = window.len() - PLAYBOOK_EXPECT_WINDOW;
                        let cut = (0..=target)
                            .rev()
                            .find(|&index| window.is_char_boundary(index))
                            .unwrap_or(0);
                        window.drain(..cut);
                    }
                }
                ChannelMsg::Eof | ChannelMsg::Close => return false,
                _ => {}
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs, io::Write, process::Command, time::SystemTime};

    #[test]
    fn unencrypted_key_ignores_an_extra_passphrase() {
        let path = temporary_ssh_key_path("unencrypted");
        generate_test_ssh_key(&path, "");

        assert!(load_secret_key(&path, Some("unused-passphrase")).is_ok());

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(format!("{}.pub", path.display()));
    }

    #[test]
    fn encrypted_key_load_errors_request_a_terminal_passphrase_prompt() {
        let path = temporary_ssh_key_path("encrypted");
        generate_test_ssh_key(&path, "correct-passphrase");

        let missing = load_secret_key(&path, None).expect_err("encrypted key needs a passphrase");
        assert!(should_prompt_for_key_passphrase(&missing.to_string(), false));
        let wrong = load_secret_key(&path, Some("wrong-passphrase"))
            .expect_err("wrong passphrase cannot decrypt key");
        assert!(should_prompt_for_key_passphrase(&wrong.to_string(), true));

        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(format!("{}.pub", path.display()));
    }

    fn temporary_ssh_key_path(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!("kkterm-{label}-{unique}"))
    }

    fn generate_test_ssh_key(path: &std::path::Path, passphrase: &str) {
        let status = Command::new("ssh-keygen")
            .args(["-q", "-t", "ed25519", "-N", passphrase, "-f"])
            .arg(path)
            .status()
            .expect("ssh-keygen is available");
        assert!(status.success(), "ssh-keygen creates the test key");
    }

    #[test]
    fn milestone_b_prefers_in_process_rust_ssh() {
        let plan = transport_plan();

        assert_eq!(plan.primary_library, "russh");
        assert_eq!(plan.sftp_candidate, "russh-sftp");
        assert_eq!(plan.fallback_library, "ssh2");
        assert_eq!(plan.system_ssh_role, "debug-fallback");
    }

    #[test]
    fn native_terminal_lifecycle_starts_for_credentials_without_proxy_jump() {
        assert!(can_start_native_terminal(
            Some("C:\\Users\\example\\.ssh\\id_ed25519"),
            None,
            false,
            false,
            None
        ));
        assert!(can_start_native_terminal(
            None,
            Some("not-for-sqlite"),
            false,
            false,
            None
        ));
        assert!(can_start_native_terminal(None, None, true, false, None));
        assert!(can_start_native_terminal(None, None, false, true, None));
        assert!(!can_start_native_terminal(None, None, false, false, None));
        assert!(!can_start_native_terminal(
            Some("  "),
            None,
            false,
            false,
            None
        ));
        assert!(!can_start_native_terminal(
            None,
            Some("  "),
            false,
            false,
            None
        ));
        assert!(!can_start_native_terminal(
            Some("C:\\Users\\example\\.ssh\\id_ed25519"),
            None,
            false,
            false,
            Some("bastion")
        ));
    }

    #[test]
    fn native_ssh_client_does_not_timeout_idle_terminal_sessions() {
        let config = native_ssh_client_config(true);

        assert_eq!(config.inactivity_timeout, None);
    }

    #[test]
    fn native_ssh_client_sends_keepalives_to_detect_dead_idle_links() {
        let config = native_ssh_client_config(true);

        // Without keepalives an idle session behind a NAT/firewall freezes:
        // the link dies silently, input is swallowed, yet the session never
        // observes EOF/Close so it keeps reporting as connected.
        assert_eq!(config.keepalive_interval, Some(SSH_KEEPALIVE_INTERVAL));
        assert!(
            config.keepalive_max > 0,
            "a dead link must be torn down after a bounded number of missed keepalives"
        );
        assert_eq!(config.keepalive_max, SSH_KEEPALIVE_MAX_MISSED);
    }

    #[test]
    fn enabling_compression_prefers_zlib_over_none() {
        // `ssh -XC` parity: with compression on, zlib must outrank `none` in the
        // client's preference list, otherwise negotiation settles on `none` and
        // X11 traffic travels uncompressed (the slow path users reported).
        let config = native_ssh_client_config(true);
        let order: Vec<&str> = config
            .preferred
            .compression
            .iter()
            .map(|name| name.as_ref())
            .collect();
        let zlib = order
            .iter()
            .position(|name| *name == "zlib@openssh.com" || *name == "zlib")
            .expect("zlib must be advertised when compression is enabled");
        let none = order
            .iter()
            .position(|name| *name == "none")
            .expect("none must remain as a fallback");
        assert!(
            zlib < none,
            "compression must be preferred ahead of none: {order:?}"
        );
    }

    #[test]
    fn disabling_compression_keeps_none_first() {
        let config = native_ssh_client_config(false);
        let first = config
            .preferred
            .compression
            .iter()
            .map(|name| name.as_ref())
            .next();
        assert_eq!(
            first,
            Some("none"),
            "with compression off the default order (none first) must be kept"
        );
    }

    #[test]
    fn x11_forwarding_request_waits_for_server_reply() {
        assert!(
            SSH_X11_REQUEST_WANT_REPLY,
            "X11 request status must reflect server acceptance or rejection"
        );
    }

    #[test]
    fn ssh_startup_timeout_bounds_stalled_preflight_work() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime is created");

        let error = runtime
            .block_on(with_ssh_startup_timeout_duration(
                "testing stalled SSH startup",
                Duration::from_millis(1),
                std::future::pending::<Result<(), String>>(),
            ))
            .expect_err("stalled preflight times out");

        assert_eq!(error, "timed out while testing stalled SSH startup");
    }

    #[test]
    fn native_tmux_terminal_resume_requires_named_tmux_session() {
        let mut request = native_terminal_request();

        request.use_tmux = true;
        request.tmux_session_id = Some("kkterm-test".to_string());
        assert!(can_resume_tmux_terminal(&request));

        request.tmux_session_id = Some("  ".to_string());
        assert!(!can_resume_tmux_terminal(&request));

        request.tmux_session_id = Some("kkterm-test".to_string());
        request.use_tmux = false;
        assert!(!can_resume_tmux_terminal(&request));
    }

    #[test]
    fn host_key_status_reports_unknown_trusted_and_changed() {
        let path = temp_known_hosts_path("status");
        let host_key = russh::keys::ssh_key::PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
        )
        .expect("host key parses");
        let changed_key = russh::keys::ssh_key::PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA6rWI3G1sz07DnfFlrouTcysQlj2P+jpNSOEWD9OJ3X",
        )
        .expect("changed host key parses");

        assert_eq!(
            host_key_status("localhost", 2222, &host_key, &path).expect("status loads"),
            HostKeyTrustStatus::Unknown
        );

        russh::keys::known_hosts::learn_known_hosts_path("localhost", 2222, &host_key, &path)
            .expect("host key is trusted");

        assert_eq!(
            host_key_status("localhost", 2222, &host_key, &path).expect("status loads"),
            HostKeyTrustStatus::Trusted
        );
        assert_eq!(
            host_key_status("localhost", 2222, &changed_key, &path).expect("status loads"),
            HostKeyTrustStatus::Changed { line: 2 }
        );
    }

    #[test]
    fn trust_host_key_replaces_changed_entry_when_requested() {
        let path = temp_known_hosts_path("replace");
        let original = russh::keys::ssh_key::PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
        )
        .expect("original host key parses");
        russh::keys::known_hosts::learn_known_hosts_path("localhost", 2222, &original, &path)
            .expect("original host key is trusted");

        let rotated =
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA6rWI3G1sz07DnfFlrouTcysQlj2P+jpNSOEWD9OJ3X";
        let preview = trust_host_key(
            path.clone(),
            TrustSshHostKeyRequest {
                host: "localhost".to_string(),
                port: Some(2222),
                public_key: rotated.to_string(),
                replace: true,
            },
        )
        .expect("changed host key is replaced when replace is requested");
        assert_eq!(preview.status, "trusted");

        let rotated_key = russh::keys::ssh_key::PublicKey::from_openssh(rotated)
            .expect("rotated host key parses");
        assert_eq!(
            host_key_status("localhost", 2222, &rotated_key, &path).expect("status loads"),
            HostKeyTrustStatus::Trusted
        );
        // `learn_known_hosts_path` always emits a leading newline when the file
        // does not already end in one (an empty file included), so the rotated
        // key lands on line 2. The original key now reports as changed there.
        assert_eq!(
            host_key_status("localhost", 2222, &original, &path).expect("status loads"),
            HostKeyTrustStatus::Changed { line: 2 }
        );
    }

    #[test]
    fn trust_host_key_refuses_changed_entry_without_replace() {
        let path = temp_known_hosts_path("refuse");
        let original = russh::keys::ssh_key::PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ",
        )
        .expect("original host key parses");
        russh::keys::known_hosts::learn_known_hosts_path("localhost", 2222, &original, &path)
            .expect("original host key is trusted");

        let error = trust_host_key(
            path,
            TrustSshHostKeyRequest {
                host: "localhost".to_string(),
                port: Some(2222),
                public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA6rWI3G1sz07DnfFlrouTcysQlj2P+jpNSOEWD9OJ3X".to_string(),
                replace: false,
            },
        )
        .expect_err("changed host key is refused without replace");
        assert!(error.contains("refusing to replace changed SSH host key"));
    }

    #[test]
    fn host_key_status_reads_hashed_known_hosts_entries() {
        let path = temp_known_hosts_path("hashed");
        let host_key = russh::keys::ssh_key::PublicKey::from_openssh(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILIG2T/B0l0gaqj3puu510tu9N1OkQ4znY3LYuEm5zCF",
        )
        .expect("host key parses");
        let mut file = fs::File::create(&path).expect("known-hosts file is created");
        writeln!(
            file,
            "|1|O33ESRMWPVkMYIwJ1Uw+n877jTo=|nuuC5vEqXlEZ/8BXQR7m619W6Ak= ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILIG2T/B0l0gaqj3puu510tu9N1OkQ4znY3LYuEm5zCF"
        )
        .expect("known-hosts entry is written");

        assert_eq!(
            host_key_status("example.com", 22, &host_key, &path).expect("status loads"),
            HostKeyTrustStatus::Trusted
        );
    }

    #[test]
    fn agent_identity_listing_error_mentions_the_agent_source() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime is created");

        let error = runtime.block_on(async {
            let (client_stream, server_stream) = tokio::io::duplex(64);
            drop(server_stream);
            let mut agent = SshAgent {
                source: "test SSH agent",
                client: AgentClient::connect(client_stream).dynamic(),
            };

            request_agent_identities(&mut agent)
                .await
                .expect_err("closed agent stream fails")
        });

        assert!(error.contains("test SSH agent"));
        assert!(error.contains("failed to list SSH agent identities"));
    }

    #[test]
    fn tmux_resume_command_does_not_embed_frontend_unavailable_marker() {
        // The startup command is typed into the remote interactive PTY, which
        // echoes it back through `terminal-output`. The frontend hides the tmux
        // label when it sees this exact marker in the output. If the marker were
        // a contiguous substring of the command, the harmless PTY echo would trip
        // detection and hide the label even though tmux is running. The marker
        // must only ever appear as runtime `printf` output on a tmux-less host.
        const FRONTEND_MARKER: &str = "[KKTerm: tmux not found, using normal shell]";
        let cmd = remote_tmux_resume_command(None, "kkterm-test", 5_000);
        assert!(
            !cmd.contains(FRONTEND_MARKER),
            "resume command must not contain the frontend tmux-unavailable marker contiguously, \
             or PTY echo hides the tmux label while tmux is running: {cmd}"
        );
    }

    #[test]
    fn tmux_resume_command_probes_session_existence_for_new_vs_attach() {
        // The host runs `has-session` before `new-session -A`, so it can authoritatively
        // tell the frontend whether the session was created or attached to.
        let cmd = remote_tmux_resume_command(None, "kkterm-test", 5_000);
        assert!(
            cmd.contains("tmux has-session -t 'kkterm-test'"),
            "command must probe session existence before attaching: {cmd}"
        );
    }

    #[test]
    fn tmux_resume_command_emits_created_and_attached_markers() {
        let cmd = remote_tmux_resume_command(None, "kkterm-test", 5_000);
        assert!(
            cmd.contains("'KKTerm: tmux session created'"),
            "command must emit the created marker on a fresh session: {cmd}"
        );
        assert!(
            cmd.contains("'KKTerm: tmux session attached'"),
            "command must emit the attached marker when reusing a session: {cmd}"
        );
    }

    #[test]
    fn tmux_resume_command_keeps_session_state_markers_non_contiguous() {
        // Same rationale as the tmux-unavailable marker: the bracketed marker must only
        // ever appear as runtime printf output, never as a literal substring the PTY
        // echo could trip on and misclassify the session state.
        let cmd = remote_tmux_resume_command(None, "kkterm-test", 5_000);
        assert!(
            !cmd.contains("[KKTerm: tmux session created]"),
            "created marker must not appear contiguously in the command source: {cmd}"
        );
        assert!(
            !cmd.contains("[KKTerm: tmux session attached]"),
            "attached marker must not appear contiguously in the command source: {cmd}"
        );
    }

    #[test]
    fn tmux_resume_command_enables_mouse_mode_for_internal_scrollback() {
        let cmd = remote_tmux_resume_command(None, "kkterm-test", 5_000);
        assert!(
            cmd.contains("\\; set-option mouse on"),
            "command must enable tmux mouse mode so tmux owns alternate-buffer scrolling: {cmd}"
        );
    }

    #[test]
    fn tmux_resume_command_enables_mouse_mode_with_initial_directory() {
        let cmd = remote_tmux_resume_command(Some("/home/user"), "kkterm-test", 5_000);
        assert!(
            cmd.contains("\\; set-option mouse on"),
            "command must enable tmux mouse mode even with initial directory: {cmd}"
        );
    }

    #[test]
    fn tmux_resume_command_sets_default_history_limit() {
        let cmd = remote_tmux_resume_command(None, "kkterm-test", 5_000);
        assert!(
            cmd.contains("\\; set-option history-limit 5000"),
            "command must keep tmux pane history aligned with KKTerm's default terminal buffer: {cmd}"
        );
    }

    #[test]
    fn tmux_resume_command_enables_osc52_clipboard_sync() {
        let cmd = remote_tmux_resume_command(None, "kkterm-test", 5_000);
        assert!(
            cmd.contains("\\; set-option set-clipboard on"),
            "command must enable tmux OSC 52 clipboard sync for new sessions: {cmd}"
        );
    }

    #[test]
    fn tmux_resume_command_uses_requested_history_limit() {
        let cmd = remote_tmux_resume_command(None, "kkterm-test", 12_000);
        assert!(
            cmd.contains("\\; set-option history-limit 12000"),
            "command must apply the SSH buffer setting to tmux history: {cmd}"
        );
    }

    #[test]
    fn disconnect_send_error_is_benign_after_remote_close() {
        assert!(is_benign_ssh_disconnect_error(&russh::Error::SendError));
        assert!(is_benign_ssh_disconnect_error(&russh::Error::HUP));
        assert!(is_benign_ssh_disconnect_error(&russh::Error::Disconnect));
    }

    #[test]
    fn non_shutdown_ssh_errors_still_surface() {
        assert!(!is_benign_ssh_disconnect_error(
            &russh::Error::ConnectionTimeout
        ));
        assert!(!is_benign_ssh_disconnect_error(
            &russh::Error::RequestDenied
        ));
    }

    #[test]
    #[ignore = "requires a trusted SSH server and credentials in KKTERM_SSH_* environment variables"]
    fn measure_native_ssh_terminal_readiness_after_auth() {
        let config =
            SshReadinessMeasurementConfig::from_env().expect("measurement env is configured");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime is created");

        let terminal_ready_ms = runtime
            .block_on(measure_terminal_readiness_after_auth(config))
            .expect("SSH readiness measurement succeeds");

        println!("KKTerm SSH terminal ready after auth: {terminal_ready_ms} ms");
        assert!(
            terminal_ready_ms <= 150,
            "SSH terminal readiness budget is <= 150 ms after auth"
        );
    }

    struct SshReadinessMeasurementConfig {
        host: String,
        user: String,
        port: u16,
        auth: NativeSshAuth,
        known_hosts_path: PathBuf,
        cols: u16,
        rows: u16,
        pixel_width: u16,
        pixel_height: u16,
        initial_directory: Option<String>,
    }

    impl SshReadinessMeasurementConfig {
        fn from_env() -> Result<Self, String> {
            let host = required_measurement_env("KKTERM_SSH_HOST")?;
            let user = env::var("KKTERM_SSH_USER")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| env::var("USERNAME").ok())
                .or_else(|| env::var("USER").ok())
                .ok_or_else(|| "set KKTERM_SSH_USER for the measurement user".to_string())?;
            let port = optional_measurement_env("KKTERM_SSH_PORT")
                .map(|value| {
                    value.parse::<u16>().map_err(|error| {
                        format!("KKTERM_SSH_PORT must be a valid TCP port: {error}")
                    })
                })
                .transpose()?
                .unwrap_or(22);
            let known_hosts_path = optional_measurement_env("KKTERM_SSH_KNOWN_HOSTS_PATH")
                .map(PathBuf::from)
                .or_else(default_app_known_hosts_path)
                .ok_or_else(|| {
                    "set KKTERM_SSH_KNOWN_HOSTS_PATH to KKTerm's trusted known-hosts file"
                        .to_string()
                })?;
            let auth = measurement_auth_from_env()?;
            let cols = optional_measurement_env("KKTERM_SSH_COLS")
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(80);
            let rows = optional_measurement_env("KKTERM_SSH_ROWS")
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(24);
            let pixel_width = optional_measurement_env("KKTERM_SSH_PIXEL_WIDTH")
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(0);
            let pixel_height = optional_measurement_env("KKTERM_SSH_PIXEL_HEIGHT")
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(0);
            let initial_directory = optional_measurement_env("KKTERM_SSH_INITIAL_DIRECTORY");

            Ok(Self {
                host,
                user,
                port,
                auth,
                known_hosts_path,
                cols,
                rows,
                pixel_width,
                pixel_height,
                initial_directory,
            })
        }
    }

    async fn measure_terminal_readiness_after_auth(
        config: SshReadinessMeasurementConfig,
    ) -> Result<u128, String> {
        let session = connect_verified_client(NativeSshConnectionRequest {
            host: config.host,
            user: config.user,
            port: config.port,
            auth: config.auth,
            known_hosts_path: config.known_hosts_path,
            x11_forwarding: None,
            socks_proxy: None,
            compression: true,
            remote_forward_targets: None,
            bridge_tasks: None,
        })
        .await?;

        let ready_start = Instant::now();
        let channel = session
            .channel_open_session()
            .await
            .map_err(|error| format!("failed to open SSH terminal channel: {error}"))?;
        channel
            .request_pty(
                false,
                "xterm-256color",
                config.cols.into(),
                config.rows.into(),
                config.pixel_width.into(),
                config.pixel_height.into(),
                &[],
            )
            .await
            .map_err(|error| format!("failed to allocate SSH PTY: {error}"))?;
        channel
            .request_shell(false)
            .await
            .map_err(|error| format!("failed to start SSH shell: {error}"))?;
        if let Some(directory) = config.initial_directory.as_deref() {
            let command = format!("cd -- {}\r", shell_single_quote(directory));
            channel
                .data(command.as_bytes())
                .await
                .map_err(|error| format!("failed to set SSH initial directory: {error}"))?;
        }
        let terminal_ready_ms = ready_start.elapsed().as_millis();

        let _ = channel.eof().await;
        let _ = channel.close().await;
        disconnect_ssh_session(&session, "readiness measured").await?;
        Ok(terminal_ready_ms)
    }

    fn measurement_auth_from_env() -> Result<NativeSshAuth, String> {
        let auth_method = optional_measurement_env("KKTERM_SSH_AUTH").unwrap_or_else(|| {
            if optional_measurement_env("KKTERM_SSH_PASSWORD").is_some() {
                "password".to_string()
            } else if optional_measurement_env("KKTERM_SSH_KEY_PATH").is_some() {
                "keyFile".to_string()
            } else {
                "agent".to_string()
            }
        });

        match auth_method.trim() {
            "agent" | "sshAgent" | "ssh-agent" => Ok(NativeSshAuth::Agent),
            "keyFile" | "key-file" | "key" => Ok(NativeSshAuth::KeyFile {
                key_path: required_measurement_env("KKTERM_SSH_KEY_PATH")?,
                passphrase: optional_measurement_env("KKTERM_SSH_KEY_PASSPHRASE"),
            }),
            "password" => Ok(NativeSshAuth::Password {
                password: Some(required_measurement_env("KKTERM_SSH_PASSWORD")?),
            }),
            _ => Err("KKTERM_SSH_AUTH must be agent, keyFile, or password".to_string()),
        }
    }

    fn required_measurement_env(name: &str) -> Result<String, String> {
        optional_measurement_env(name).ok_or_else(|| format!("set {name} before measuring"))
    }

    fn optional_measurement_env(name: &str) -> Option<String> {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }

    fn default_app_known_hosts_path() -> Option<PathBuf> {
        if cfg!(target_os = "windows") {
            env::var_os("APPDATA")
                .map(PathBuf::from)
                .map(|path| path.join("com.kkterm.app").join("ssh_known_hosts"))
        } else if let Some(data_home) = env::var_os("XDG_DATA_HOME") {
            Some(
                PathBuf::from(data_home)
                    .join("com.kkterm.app")
                    .join("ssh_known_hosts"),
            )
        } else {
            env::var_os("HOME").map(|home| {
                PathBuf::from(home)
                    .join(".local")
                    .join("share")
                    .join("com.kkterm.app")
                    .join("ssh_known_hosts")
            })
        }
    }

    fn temp_known_hosts_path(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is after Unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kkterm-known-hosts-{name}-{unique}"));
        fs::create_dir_all(&dir).expect("temp directory is created");
        dir.join("known_hosts")
    }

    fn native_terminal_request() -> NativeSshTerminalRequest {
        NativeSshTerminalRequest {
            session_id: "native-test".to_string(),
            host: "example.internal".to_string(),
            user: "ryan".to_string(),
            port: 22,
            auth: NativeSshAuth::Agent,
            known_hosts_path: temp_known_hosts_path("native-request"),
            cols: 80,
            pixel_height: 0,
            pixel_width: 0,
            rows: 24,
            initial_directory: None,
            use_tmux: false,
            tmux_session_id: None,
            tmux_history_limit: 5_000,
            x11_forwarding: None,
            socks_proxy: None,
            compression: true,
        }
    }

    #[test]
    fn x11_port_maps_display_to_local_tcp_port() {
        assert_eq!(x11_port(0), 6000);
        assert_eq!(x11_port(7), 6007);
        assert_eq!(x11_port(100), 6099);
    }
}

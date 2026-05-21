#[cfg(target_os = "windows")]
use crate::windows_local_pty;
use crate::{secrets, serial, ssh, telnet};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    ffi::OsString,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener as StdTcpListener},
    process::Command as ProcessCommand,
    sync::Mutex,
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
};

pub struct SessionManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    ssh_context_cache: Mutex<HashMap<String, Result<String, String>>>,
    ssh_port_forwards: Mutex<HashMap<String, SshPortForwardSession>>,
}

struct TerminalSession {
    transport: TerminalTransport,
}

struct SshPortForwardSession {
    stop: Option<oneshot::Sender<()>>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for SshPortForwardSession {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

enum TerminalTransport {
    Pty {
        master: Box<dyn MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        child: Box<dyn Child + Send + Sync>,
    },
    NativeSsh(ssh::NativeSshTerminal),
    NativeTelnet(telnet::NativeTelnetTerminal),
    NativeSerial(serial::NativeSerialTerminal),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTerminalSessionRequest {
    pub session_id: Option<String>,
    pub title: String,
    #[serde(rename = "type")]
    pub connection_type: String,
    pub host: String,
    pub user: String,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub proxy_jump: Option<String>,
    pub auth_method: Option<String>,
    pub secret_owner_id: Option<String>,
    pub shell: Option<String>,
    pub serial_line: Option<String>,
    pub serial_speed: Option<u32>,
    pub initial_directory: Option<String>,
    pub cols: Option<u16>,
    pub pixel_height: Option<u16>,
    pub pixel_width: Option<u16>,
    pub rows: Option<u16>,
    pub use_tmux: Option<bool>,
    pub tmux_session_id: Option<String>,
    pub ssh_buffer_lines: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxConnectionRequest {
    pub host: String,
    pub user: String,
    pub port: Option<u16>,
    pub key_path: Option<String>,
    pub proxy_jump: Option<String>,
    pub auth_method: Option<String>,
    pub secret_owner_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTmuxSessionRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameTmuxSessionRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
    pub new_tmux_session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTmuxPaneRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
    pub buffer_lines: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTmuxSessionMouseRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub tmux_session_id: String,
    pub enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSshPortForwardRequest {
    #[serde(flatten)]
    pub connection: TmuxConnectionRequest,
    pub remote_port: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseSshPortForwardRequest {
    pub forward_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLoopbackPort {
    pub port: u16,
    pub address: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPortForwardStarted {
    pub forward_id: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSession {
    pub id: String,
    pub attached: bool,
    pub windows: u32,
    pub created: Option<u64>,
    pub internal_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchElevatedTerminalRequest {
    pub shell: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionStarted {
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    terminal_ready_ms: Option<u128>,
}

impl TerminalSessionStarted {
    pub fn terminal_ready_ms(&self) -> Option<u128> {
        self.terminal_ready_ms
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub(crate) session_id: String,
    pub(crate) data: String,
}

/// Tap the watchdog session-activity tracker so a `sshSessionOutputSilence`
/// watchdog observes the byte the same tick the user does. Free function
/// (no &self) so the read threads inside `start_terminal_session` can call
/// it cheaply without holding the SessionManager mutex.
pub(crate) fn record_session_activity(app: &AppHandle, session_id: &str, data: &str) {
    if let Some(tracker) =
        app.try_state::<std::sync::Arc<crate::watchdog::SessionActivityTracker>>()
    {
        tracker.record(session_id, data.as_bytes());
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputRequest {
    session_id: String,
    data: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalRequest {
    session_id: String,
    cols: u16,
    pixel_height: Option<u16>,
    pixel_width: Option<u16>,
    rows: u16,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            ssh_context_cache: Mutex::new(HashMap::new()),
            ssh_port_forwards: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_terminal_session(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: StartTerminalSessionRequest,
    ) -> Result<TerminalSessionStarted, String> {
        let session_id = request
            .session_id
            .clone()
            .unwrap_or_else(|| make_session_id(&request.title));
        let is_local_start = request.connection_type.trim().eq_ignore_ascii_case("local");
        let password = connection_password_for(secrets, &request);
        if request
            .connection_type
            .trim()
            .eq_ignore_ascii_case("telnet")
        {
            let password =
                password.ok_or_else(|| "password is required for Telnet sessions".to_string())?;
            let session = telnet::start_native_terminal(
                app,
                telnet::NativeTelnetTerminalRequest {
                    session_id: session_id.clone(),
                    host: request.host.clone(),
                    user: request.user.clone(),
                    port: request.port.unwrap_or(23),
                    password,
                },
            )?;
            self.sessions
                .lock()
                .map_err(|_| "terminal session lock is poisoned".to_string())?
                .insert(
                    session_id.clone(),
                    TerminalSession {
                        transport: TerminalTransport::NativeTelnet(session),
                    },
                );
            return Ok(TerminalSessionStarted {
                session_id,
                terminal_ready_ms: None,
            });
        }

        if request
            .connection_type
            .trim()
            .eq_ignore_ascii_case("serial")
        {
            let line = request
                .serial_line
                .clone()
                .unwrap_or_else(|| request.host.clone());
            let session = serial::start_native_terminal(
                app,
                serial::NativeSerialTerminalRequest {
                    session_id: session_id.clone(),
                    line,
                    speed: request
                        .serial_speed
                        .or(request.port.map(u32::from))
                        .unwrap_or(9600),
                },
            )?;
            self.sessions
                .lock()
                .map_err(|_| "terminal session lock is poisoned".to_string())?
                .insert(
                    session_id.clone(),
                    TerminalSession {
                        transport: TerminalTransport::NativeSerial(session),
                    },
                );
            return Ok(TerminalSessionStarted {
                session_id,
                terminal_ready_ms: None,
            });
        }

        let auth_method = ssh_auth_method_for(&request, password.as_deref())?;
        if uses_native_ssh(&request, password.as_deref(), &auth_method) {
            let known_hosts_path = ssh::app_known_hosts_path(&app)?;
            let auth = native_ssh_auth_for(&request, password, &auth_method)?;
            match ssh::start_native_terminal(
                app.clone(),
                ssh::NativeSshTerminalRequest {
                    session_id: session_id.clone(),
                    host: request.host.clone(),
                    user: request.user.clone(),
                    port: request.port.unwrap_or(22),
                    auth,
                    known_hosts_path,
                    cols: request.cols.unwrap_or(80),
                    pixel_height: request.pixel_height.unwrap_or(0),
                    pixel_width: request.pixel_width.unwrap_or(0),
                    rows: request.rows.unwrap_or(24),
                    initial_directory: request.initial_directory.clone(),
                    use_tmux: request.use_tmux.unwrap_or(false),
                    tmux_session_id: request.tmux_session_id.clone(),
                    tmux_history_limit: ssh_buffer_lines_for(request.ssh_buffer_lines),
                },
            ) {
                Ok(session) => {
                    let terminal_ready_ms = session.terminal_ready_ms();
                    self.sessions
                        .lock()
                        .map_err(|_| "terminal session lock is poisoned".to_string())?
                        .insert(
                            session_id.clone(),
                            TerminalSession {
                                transport: TerminalTransport::NativeSsh(session),
                            },
                        );
                    return Ok(TerminalSessionStarted {
                        session_id,
                        terminal_ready_ms: Some(terminal_ready_ms),
                    });
                }
                Err(error) if should_fallback_to_interactive_ssh(&error) => {
                    let _ = app.emit(
                        "terminal-output",
                        TerminalOutput {
                            session_id: session_id.clone(),
                            data: "\r\n[fallback: starting interactive ssh for username/password authentication]\r\n"
                                .to_string(),
                        },
                    );
                }
                Err(error) => return Err(error),
            }
        }

        #[cfg(target_os = "windows")]
        if is_local_start {
            let command = command_for(&request)?;
            let local_pty =
                windows_local_pty::spawn_local_shell(pty_size_for(&request), command)
                    .map_err(|error| format!("failed to start Windows local shell: {error}"))?;
            let session = TerminalSession {
                transport: TerminalTransport::Pty {
                    master: local_pty.master,
                    writer: local_pty.writer,
                    child: local_pty.child,
                },
            };
            self.sessions
                .lock()
                .map_err(|_| "terminal session lock is poisoned".to_string())?
                .insert(session_id.clone(), session);

            let output_session_id = session_id.clone();
            thread::spawn(move || {
                let mut reader = local_pty.reader;
                let mut buffer = [0_u8; 8192];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(count) => {
                            let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                            record_session_activity(&app, &output_session_id, &data);
                            let _ = app.emit(
                                "terminal-output",
                                TerminalOutput {
                                    session_id: output_session_id.clone(),
                                    data,
                                },
                            );
                        }
                        Err(error) => {
                            let data = format!("\r\n[session read error: {error}]\r\n");
                            record_session_activity(&app, &output_session_id, &data);
                            let _ = app.emit(
                                "terminal-output",
                                TerminalOutput {
                                    session_id: output_session_id.clone(),
                                    data,
                                },
                            );
                            break;
                        }
                    }
                }
            });
            return Ok(TerminalSessionStarted {
                session_id,
                terminal_ready_ms: None,
            });
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(pty_size_for(&request))
            .map_err(|error| format!("failed to open PTY: {error}"))?;

        let command = command_for(&request)?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("failed to create PTY reader: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("failed to create PTY writer: {error}"))?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("failed to start terminal process: {error}"))?;
        drop(pair.slave);

        let session = TerminalSession {
            transport: TerminalTransport::Pty {
                master: pair.master,
                writer,
                child,
            },
        };
        self.sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?
            .insert(session_id.clone(), session);

        let output_session_id = session_id.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(count) => {
                        let data = String::from_utf8_lossy(&buffer[..count]).to_string();
                        let _ = app.emit(
                            "terminal-output",
                            TerminalOutput {
                                session_id: output_session_id.clone(),
                                data,
                            },
                        );
                    }
                    Err(error) => {
                        let _ = app.emit(
                            "terminal-output",
                            TerminalOutput {
                                session_id: output_session_id.clone(),
                                data: format!("\r\n[session read error: {error}]\r\n"),
                            },
                        );
                        break;
                    }
                }
            }
        });

        Ok(TerminalSessionStarted {
            session_id,
            terminal_ready_ms: None,
        })
    }

    pub fn list_tmux_sessions(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxConnectionRequest,
    ) -> Result<Vec<TmuxSession>, String> {
        let output = run_tmux_command(app, secrets, &request, tmux_list_command())?;
        Ok(parse_tmux_sessions(&output))
    }

    pub fn close_tmux_session(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: CloseTmuxSessionRequest,
    ) -> Result<(), String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_close_command(&tmux_session_id),
        )?;
        Ok(())
    }

    pub fn rename_tmux_session(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: RenameTmuxSessionRequest,
    ) -> Result<(), String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        let new_tmux_session_id = required_tmux_session_id(request.new_tmux_session_id)?;
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_rename_session_command(&tmux_session_id, &new_tmux_session_id),
        )?;
        Ok(())
    }

    pub fn set_tmux_session_mouse(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: SetTmuxSessionMouseRequest,
    ) -> Result<(), String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        let mouse_value = if request.enabled { "on" } else { "off" };
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            format!(
                "tmux set-option -t {} mouse {}",
                shell_single_quote(&tmux_session_id),
                mouse_value
            ),
        )?;
        Ok(())
    }

    pub fn capture_tmux_pane(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: CaptureTmuxPaneRequest,
    ) -> Result<String, String> {
        let tmux_session_id = required_tmux_session_id(request.tmux_session_id)?;
        run_tmux_command(
            app,
            secrets,
            &request.connection,
            tmux_capture_pane_command(&tmux_session_id, ssh_buffer_lines_for(request.buffer_lines)),
        )
    }

    pub fn inspect_ssh_system_context(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxConnectionRequest,
    ) -> Result<String, String> {
        let cache_key = ssh_system_context_cache_key(&request);
        if let Some(cached) = self
            .ssh_context_cache
            .lock()
            .map_err(|_| "SSH system context cache lock is poisoned".to_string())?
            .get(&cache_key)
            .cloned()
        {
            return cached;
        }

        let result = run_ssh_command(
            app,
            secrets,
            &request,
            ssh_system_context_command(),
            Some(Duration::from_secs(3)),
        );
        self.ssh_context_cache
            .lock()
            .map_err(|_| "SSH system context cache lock is poisoned".to_string())?
            .insert(cache_key, result.clone());
        result
    }

    pub fn list_remote_loopback_ports(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: TmuxConnectionRequest,
        hide_common_ports: bool,
    ) -> Result<Vec<RemoteLoopbackPort>, String> {
        let output = run_ssh_command(
            app,
            secrets,
            &request,
            remote_loopback_port_command(),
            Some(Duration::from_secs(5)),
        )?;
        Ok(filter_remote_loopback_ports(
            parse_remote_loopback_ports(&output),
            hide_common_ports,
        ))
    }

    pub fn start_ssh_port_forward(
        &self,
        app: AppHandle,
        secrets: &secrets::Secrets,
        request: StartSshPortForwardRequest,
    ) -> Result<SshPortForwardStarted, String> {
        let remote_port = request.remote_port;
        if remote_port == 0 {
            return Err("remote port must be between 1 and 65535".to_string());
        }

        let terminal_request = terminal_request_for_tmux(&request.connection);
        let password = connection_password_for(secrets, &terminal_request);
        let auth_method = ssh_auth_method_for(&terminal_request, password.as_deref())?;
        if !uses_native_ssh(&terminal_request, password.as_deref(), &auth_method) {
            return Err(
                "SSH port forwarding currently requires a native SSH Connection without ProxyJump"
                    .to_string(),
            );
        }

        let connection = ssh::NativeSshConnectionRequest {
            host: terminal_request.host.clone(),
            user: terminal_request.user.clone(),
            port: terminal_request.port.unwrap_or(22),
            auth: native_ssh_auth_for(&terminal_request, password, &auth_method)?,
            known_hosts_path: ssh::app_known_hosts_path(&app)?,
        };
        let listener = StdTcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|error| format!("failed to bind local port forward listener: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("failed to configure local port forward listener: {error}"))?;
        let local_port = listener
            .local_addr()
            .map_err(|error| format!("failed to read local port forward address: {error}"))?
            .port();
        let forward_id = make_session_id(&format!(
            "ssh-forward-{}-{}",
            terminal_request.host, remote_port
        ));
        let (stop_tx, stop_rx) = oneshot::channel();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let worker_forward_id = forward_id.clone();
        let worker = thread::spawn(move || {
            let result =
                run_ssh_port_forward_thread(listener, connection, remote_port, stop_rx, ready_tx);
            if let Err(error) = result {
                eprintln!("SSH port forward {worker_forward_id} stopped: {error}");
            }
        });

        match ready_rx.recv_timeout(Duration::from_secs(15)) {
            Ok(Ok(())) => {
                self.ssh_port_forwards
                    .lock()
                    .map_err(|_| "SSH port forward lock is poisoned".to_string())?
                    .insert(
                        forward_id.clone(),
                        SshPortForwardSession {
                            stop: Some(stop_tx),
                            worker: Some(worker),
                        },
                    );
                Ok(SshPortForwardStarted {
                    forward_id,
                    local_port,
                    remote_port,
                    url: format!("http://127.0.0.1:{local_port}"),
                })
            }
            Ok(Err(error)) => {
                let _ = worker.join();
                Err(error)
            }
            Err(_) => {
                let _ = stop_tx.send(());
                let _ = worker.join();
                Err("timed out while starting SSH port forward".to_string())
            }
        }
    }

    pub fn close_ssh_port_forward(
        &self,
        request: CloseSshPortForwardRequest,
    ) -> Result<(), String> {
        self.ssh_port_forwards
            .lock()
            .map_err(|_| "SSH port forward lock is poisoned".to_string())?
            .remove(&request.forward_id);
        Ok(())
    }

    pub fn write_terminal_input(&self, request: TerminalInputRequest) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?;
        let session = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| "terminal session was not found".to_string())?;
        match &mut session.transport {
            TerminalTransport::Pty { writer, .. } => {
                writer
                    .write_all(&request.data)
                    .map_err(|error| format!("failed to write terminal input: {error}"))?;
                writer
                    .flush()
                    .map_err(|error| format!("failed to flush terminal input: {error}"))
            }
            TerminalTransport::NativeSsh(session) => session.write_input(request.data),
            TerminalTransport::NativeTelnet(session) => session.write_input(request.data),
            TerminalTransport::NativeSerial(session) => session.write_input(request.data),
        }
    }

    pub fn resize_terminal(&self, request: ResizeTerminalRequest) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| "terminal session was not found".to_string())?;
        match &session.transport {
            TerminalTransport::Pty { master, .. } => master
                .resize(resize_pty_size(&request))
                .map_err(|error| format!("failed to resize terminal: {error}")),
            TerminalTransport::NativeSsh(session) => session.resize(
                request.cols,
                request.rows,
                request.pixel_width.unwrap_or(0),
                request.pixel_height.unwrap_or(0),
            ),
            TerminalTransport::NativeTelnet(_) | TerminalTransport::NativeSerial(_) => Ok(()),
        }
    }

    pub fn close_terminal_session(&self, session_id: String) -> Result<(), String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "terminal session lock is poisoned".to_string())?
            .remove(&session_id);
        if let Some(mut session) = session {
            match session.transport {
                TerminalTransport::Pty { ref mut child, .. } => {
                    let _ = child.kill();
                }
                TerminalTransport::NativeSsh(session) => session.close(),
                TerminalTransport::NativeTelnet(session) => session.close(),
                TerminalTransport::NativeSerial(session) => session.close(),
            }
        }
        Ok(())
    }
}

pub fn launch_elevated_terminal(request: LaunchElevatedTerminalRequest) -> Result<(), String> {
    launch_elevated_terminal_impl(normalize_elevated_shell(&request.shell)?)
}

fn normalize_elevated_shell(shell: &str) -> Result<&'static str, String> {
    match shell.trim().to_lowercase().as_str() {
        "cmd.exe" => Ok("cmd.exe"),
        "powershell.exe" => Ok("powershell.exe"),
        _ => Err("elevated terminal shell must be Command Prompt or PowerShell".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn launch_elevated_terminal_impl(shell: &str) -> Result<(), String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let operation = wide_string("runas");
    let file = wide_string(shell);
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    } as isize;

    if result <= 32 {
        return Err(format!("failed to launch elevated {shell}"));
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_elevated_terminal_impl(_shell: &str) -> Result<(), String> {
    Err("elevated local terminals are only available on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn wide_string(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn pty_size_for(request: &StartTerminalSessionRequest) -> PtySize {
    PtySize {
        rows: request.rows.unwrap_or(24),
        cols: request.cols.unwrap_or(80),
        pixel_width: request.pixel_width.unwrap_or(0),
        pixel_height: request.pixel_height.unwrap_or(0),
    }
}

fn resize_pty_size(request: &ResizeTerminalRequest) -> PtySize {
    PtySize {
        rows: request.rows,
        cols: request.cols,
        pixel_width: request.pixel_width.unwrap_or(0),
        pixel_height: request.pixel_height.unwrap_or(0),
    }
}

fn uses_native_ssh(
    request: &StartTerminalSessionRequest,
    password: Option<&str>,
    auth_method: &SshAuthMethod,
) -> bool {
    request.connection_type.trim().eq_ignore_ascii_case("ssh")
        && ssh::can_start_native_terminal(
            request.key_path.as_deref(),
            password,
            matches!(auth_method, SshAuthMethod::Agent),
            request.proxy_jump.as_deref(),
        )
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SshAuthMethod {
    KeyFile,
    Password,
    Agent,
}

fn ssh_auth_method_for(
    request: &StartTerminalSessionRequest,
    password: Option<&str>,
) -> Result<SshAuthMethod, String> {
    match request
        .auth_method
        .as_deref()
        .map(str::trim)
        .filter(|method| !method.is_empty())
    {
        Some("keyFile") | Some("key-file") | Some("key") => Ok(SshAuthMethod::KeyFile),
        Some("password") => Ok(SshAuthMethod::Password),
        Some("agent") | Some("sshAgent") | Some("ssh-agent") => Ok(SshAuthMethod::Agent),
        Some(_) => Err("SSH auth method must be keyFile, password, or agent".to_string()),
        None if request
            .key_path
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty()) =>
        {
            Ok(SshAuthMethod::KeyFile)
        }
        None if password.is_some() => Ok(SshAuthMethod::Password),
        None => Ok(SshAuthMethod::Agent),
    }
}

fn native_ssh_auth_for(
    request: &StartTerminalSessionRequest,
    password: Option<String>,
    auth_method: &SshAuthMethod,
) -> Result<ssh::NativeSshAuth, String> {
    match auth_method {
        SshAuthMethod::KeyFile => Ok(ssh::NativeSshAuth::KeyFile {
            key_path: request.key_path.clone().unwrap_or_default(),
        }),
        SshAuthMethod::Password => Ok(ssh::NativeSshAuth::Password {
            password: password
                .ok_or_else(|| "password is required for native SSH sessions".to_string())?,
        }),
        SshAuthMethod::Agent => Ok(ssh::NativeSshAuth::Agent),
    }
}

fn should_fallback_to_interactive_ssh(error: &str) -> bool {
    let normalized = error.to_lowercase();
    normalized.contains("authentication")
        && !normalized.contains("host key")
        && !normalized.contains("known host")
}

fn connection_password_for(
    secrets: &secrets::Secrets,
    request: &StartTerminalSessionRequest,
) -> Option<String> {
    if request
        .connection_type
        .trim()
        .eq_ignore_ascii_case("telnet")
    {
        return request.secret_owner_id.as_ref().and_then(|owner_id| {
            secrets
                .read_connection_password(owner_id.clone())
                .ok()
                .flatten()
        });
    }

    if !request.connection_type.trim().eq_ignore_ascii_case("ssh") {
        return None;
    }
    if !matches!(
        ssh_auth_method_for(request, None),
        Ok(SshAuthMethod::Password)
    ) {
        return None;
    }
    if request
        .proxy_jump
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return None;
    }
    if request
        .key_path
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return None;
    }

    request.secret_owner_id.as_ref().and_then(|owner_id| {
        secrets
            .read_connection_password(owner_id.clone())
            .ok()
            .flatten()
    })
}

fn run_tmux_command(
    app: AppHandle,
    secrets: &secrets::Secrets,
    request: &TmuxConnectionRequest,
    command: String,
) -> Result<String, String> {
    run_ssh_command(app, secrets, request, command, None)
}

fn run_ssh_command(
    app: AppHandle,
    secrets: &secrets::Secrets,
    request: &TmuxConnectionRequest,
    command: String,
    timeout: Option<Duration>,
) -> Result<String, String> {
    let terminal_request = terminal_request_for_tmux(request);
    let password = connection_password_for(secrets, &terminal_request);
    let auth_method = ssh_auth_method_for(&terminal_request, password.as_deref())?;
    if uses_native_ssh(&terminal_request, password.as_deref(), &auth_method) {
        return ssh::run_remote_command(ssh::NativeSshCommandRequest {
            host: terminal_request.host.clone(),
            user: terminal_request.user.clone(),
            port: terminal_request.port.unwrap_or(22),
            auth: native_ssh_auth_for(&terminal_request, password, &auth_method)?,
            known_hosts_path: ssh::app_known_hosts_path(&app)?,
            command,
            timeout_seconds: timeout.map(|duration| duration.as_secs().max(1)),
        });
    }

    run_system_ssh_command(&terminal_request, command, timeout)
}

fn run_ssh_port_forward_thread(
    listener: StdTcpListener,
    connection: ssh::NativeSshConnectionRequest,
    remote_port: u16,
    stop_rx: oneshot::Receiver<()>,
    ready_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create SSH port forward runtime: {error}"))?;

    runtime.block_on(run_ssh_port_forward(
        listener,
        connection,
        remote_port,
        stop_rx,
        ready_tx,
    ))
}

async fn run_ssh_port_forward(
    listener: StdTcpListener,
    connection: ssh::NativeSshConnectionRequest,
    remote_port: u16,
    mut stop_rx: oneshot::Receiver<()>,
    ready_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let ssh_session = match tokio::time::timeout(
        Duration::from_secs(15),
        ssh::connect_verified_client(connection),
    )
    .await
    {
        Ok(Ok(session)) => session,
        Ok(Err(error)) => {
            let _ = ready_tx.send(Err(error.clone()));
            return Err(error);
        }
        Err(_) => {
            let error = "timed out while connecting SSH port forward".to_string();
            let _ = ready_tx.send(Err(error.clone()));
            return Err(error);
        }
    };
    let listener = match TcpListener::from_std(listener) {
        Ok(listener) => listener,
        Err(error) => {
            let _ = ready_tx.send(Err(format!(
                "failed to start local port forward listener: {error}"
            )));
            return Err(format!(
                "failed to start local port forward listener: {error}"
            ));
        }
    };
    let _ = ready_tx.send(Ok(()));
    let ssh_session = std::sync::Arc::new(tokio::sync::Mutex::new(ssh_session));

    loop {
        tokio::select! {
            _ = &mut stop_rx => break,
            accepted = listener.accept() => {
                let (stream, originator) = accepted
                    .map_err(|error| format!("failed to accept local port forward connection: {error}"))?;
                let ssh_session = std::sync::Arc::clone(&ssh_session);
                tokio::spawn(async move {
                    if let Err(error) = forward_local_stream(stream, originator, remote_port, ssh_session).await {
                        eprintln!("SSH port forward connection failed: {error}");
                    }
                });
            }
        }
    }

    if let Ok(session) = std::sync::Arc::try_unwrap(ssh_session) {
        let session = session.into_inner();
        let _ = ssh::disconnect_ssh_session(session, "port forward closed").await;
    }
    Ok(())
}

async fn forward_local_stream(
    mut stream: TcpStream,
    originator: SocketAddr,
    remote_port: u16,
    ssh_session: std::sync::Arc<tokio::sync::Mutex<russh::client::Handle<ssh::VerifyingClient>>>,
) -> Result<(), String> {
    let originator_ip = originator.ip().to_string();
    let originator_port = u32::from(originator.port());
    let mut channel = {
        let session = ssh_session.lock().await;
        session
            .channel_open_direct_tcpip(
                "127.0.0.1".to_string(),
                u32::from(remote_port),
                originator_ip,
                originator_port,
            )
            .await
            .map_err(|error| format!("failed to open SSH direct-tcpip channel: {error}"))?
    };

    let mut stream_closed = false;
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        tokio::select! {
            read = stream.read(&mut buffer), if !stream_closed => {
                match read {
                    Ok(0) => {
                        stream_closed = true;
                        channel
                            .eof()
                            .await
                            .map_err(|error| format!("failed to close SSH channel input: {error}"))?;
                    }
                    Ok(count) => {
                        channel
                            .data(&buffer[..count])
                            .await
                            .map_err(|error| format!("failed to write SSH channel data: {error}"))?;
                    }
                    Err(error) => return Err(format!("failed to read local forwarded connection: {error}")),
                }
            }
            message = channel.wait() => {
                match message {
                    Some(russh::ChannelMsg::Data { data }) | Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                        stream
                            .write_all(&data)
                            .await
                            .map_err(|error| format!("failed to write local forwarded connection: {error}"))?;
                    }
                    Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
    let _ = channel.close().await;
    let _ = stream.shutdown().await;
    Ok(())
}

fn remote_loopback_port_command() -> String {
    "if command -v ss >/dev/null 2>&1; then ss -H -ltn; elif command -v netstat >/dev/null 2>&1; then netstat -ltn; elif command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP -sTCP:LISTEN; else printf 'KKTerm: no ss, netstat, or lsof available\\n' >&2; fi".to_string()
}

fn parse_remote_loopback_ports(output: &str) -> Vec<RemoteLoopbackPort> {
    let mut ports = BTreeMap::new();
    for line in output.lines() {
        for token in line.split_whitespace() {
            if let Some((address, port)) = parse_loopback_endpoint(token) {
                ports
                    .entry(port)
                    .or_insert(RemoteLoopbackPort { port, address });
            }
        }
    }
    ports.into_values().collect()
}

fn filter_remote_loopback_ports(
    ports: Vec<RemoteLoopbackPort>,
    hide_common_ports: bool,
) -> Vec<RemoteLoopbackPort> {
    if !hide_common_ports {
        return ports;
    }

    ports
        .into_iter()
        .filter(|entry| entry.port >= 1024 || entry.port == 80 || entry.port == 443)
        .collect()
}

fn parse_loopback_endpoint(token: &str) -> Option<(String, u16)> {
    let trimmed = token.trim_matches(|c: char| c == ',' || c == '"' || c == '\'');
    let normalized = trimmed
        .strip_prefix("TCP@")
        .or_else(|| trimmed.strip_prefix("TCP"))
        .unwrap_or(trimmed);
    let normalized = normalized
        .strip_prefix("http://")
        .or_else(|| normalized.strip_prefix("https://"))
        .unwrap_or(normalized);
    let (host, port) = split_host_port(normalized)?;
    let host = host.trim_matches(['[', ']']);
    if !is_loopback_host(host) {
        return None;
    }
    Some((host.to_string(), port))
}

fn split_host_port(value: &str) -> Option<(&str, u16)> {
    if let Some(closing) = value.find("]:") {
        let host = value.get(1..closing)?;
        let port = value.get(closing + 2..)?.parse().ok()?;
        return Some((host, port));
    }

    let (host, port) = value.rsplit_once(':')?;
    if port == "*" {
        return None;
    }
    Some((host, port.parse().ok()?))
}

fn is_loopback_host(host: &str) -> bool {
    let host = host.trim();
    host.eq_ignore_ascii_case("localhost")
        || host == "::1"
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn terminal_request_for_tmux(request: &TmuxConnectionRequest) -> StartTerminalSessionRequest {
    StartTerminalSessionRequest {
        session_id: None,
        title: "tmux".to_string(),
        connection_type: "ssh".to_string(),
        host: request.host.clone(),
        user: request.user.clone(),
        port: request.port,
        key_path: request.key_path.clone(),
        proxy_jump: request.proxy_jump.clone(),
        auth_method: request.auth_method.clone(),
        secret_owner_id: request.secret_owner_id.clone(),
        shell: None,
        serial_line: None,
        serial_speed: None,
        initial_directory: None,
        cols: None,
        pixel_height: None,
        pixel_width: None,
        rows: None,
        use_tmux: None,
        tmux_session_id: None,
        ssh_buffer_lines: None,
    }
}

fn run_system_ssh_command(
    request: &StartTerminalSessionRequest,
    remote_command: String,
    timeout: Option<Duration>,
) -> Result<String, String> {
    let host = request.host.trim();
    if host.is_empty() {
        return Err("host is required for SSH sessions".to_string());
    }

    let mut command = ProcessCommand::new("ssh");
    command.arg("-T");
    command.arg("-o");
    command.arg("BatchMode=yes");
    if let Some(port) = request.port {
        command.arg("-p");
        command.arg(port.to_string());
    }
    if let Some(key_path) = request.key_path.as_ref().map(|value| value.trim()) {
        if !key_path.is_empty() {
            command.arg("-i");
            command.arg(key_path);
        }
    }
    if let Some(proxy_jump) = request.proxy_jump.as_ref().map(|value| value.trim()) {
        if !proxy_jump.is_empty() {
            command.arg("-J");
            command.arg(proxy_jump);
        }
    }

    let target = match request.user.trim() {
        "" => host.to_string(),
        user => format!("{user}@{host}"),
    };
    command.arg(target);
    command.arg(remote_command);

    let output = if let Some(timeout) = timeout {
        run_command_with_timeout(command, timeout)?
    } else {
        command
            .output()
            .map_err(|error| format!("failed to run system ssh: {error}"))?
    };
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("system ssh command failed: {stderr}"))
    }
}

fn run_command_with_timeout(
    mut command: ProcessCommand,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to run system ssh: {error}"))?;
    let deadline = Instant::now() + timeout;
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("failed to wait for system ssh: {error}"))?
        {
            Some(_) => {
                return child
                    .wait_with_output()
                    .map_err(|error| format!("failed to collect system ssh output: {error}"));
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "system ssh command timed out after {} seconds",
                    timeout.as_secs()
                ));
            }
            None => thread::sleep(Duration::from_millis(25)),
        }
    }
}

fn ssh_system_context_cache_key(request: &TmuxConnectionRequest) -> String {
    format!(
        "{}:{}:{}",
        request.host.trim().to_ascii_lowercase(),
        request.port.unwrap_or(22),
        request
            .proxy_jump
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_ascii_lowercase()
    )
}

fn tmux_list_command() -> String {
    "if command -v tmux >/dev/null 2>&1; then tmux list-sessions -F '#{session_name}\t#{session_attached}\t#{session_windows}\t#{session_created}\t#{session_id}' 2>/dev/null || true; fi".to_string()
}

fn tmux_close_command(tmux_session_id: &str) -> String {
    format!(
        "if command -v tmux >/dev/null 2>&1; then tmux kill-session -t {}; fi",
        shell_single_quote(tmux_session_id)
    )
}

fn tmux_rename_session_command(tmux_session_id: &str, new_tmux_session_id: &str) -> String {
    format!(
        "if command -v tmux >/dev/null 2>&1; then tmux rename-session -t {} {}; fi",
        shell_single_quote(tmux_session_id),
        shell_single_quote(new_tmux_session_id)
    )
}

const DEFAULT_SSH_BUFFER_LINES: u32 = 5_000;

fn ssh_buffer_lines_for(value: Option<u32>) -> u32 {
    value
        .filter(|lines| (100..=100_000).contains(lines))
        .unwrap_or(DEFAULT_SSH_BUFFER_LINES)
}

fn tmux_capture_pane_command(tmux_session_id: &str, buffer_lines: u32) -> String {
    format!(
        "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux capture-pane -p -S -{} -t {}:",
        ssh_buffer_lines_for(Some(buffer_lines)),
        shell_single_quote(tmux_session_id),
    )
}

fn ssh_system_context_command() -> String {
    r#"printf 'Hostname: '; hostname 2>/dev/null || printf 'unknown'; printf '\n'
printf 'User: '; whoami 2>/dev/null || printf 'unknown'; printf '\n'
printf 'Kernel: '; uname -srmo 2>/dev/null || uname -a 2>/dev/null || printf 'unknown'; printf '\n'
if [ -r /etc/os-release ]; then
  . /etc/os-release
  printf 'OS: %s\n' "${PRETTY_NAME:-${NAME:-unknown}}"
elif command -v lsb_release >/dev/null 2>&1; then
  printf 'OS: '; lsb_release -ds 2>/dev/null
else
  printf 'OS: unknown\n'
fi
printf 'Architecture: '; uname -m 2>/dev/null || printf 'unknown'; printf '\n'
printf 'CPU: '
if command -v nproc >/dev/null 2>&1; then
  printf '%s cores' "$(nproc 2>/dev/null)"
else
  grep -c '^processor' /proc/cpuinfo 2>/dev/null | tr -d '\n' || printf 'unknown'
  printf ' cores'
fi
if [ -r /proc/cpuinfo ]; then
  cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed 's/^ //')
  if [ -n "$cpu_model" ]; then printf ' (%s)' "$cpu_model"; fi
fi
printf '\n'
printf 'Memory: '
if command -v free >/dev/null 2>&1; then
  free -h 2>/dev/null | awk '/^Mem:/ {print $2 " total, " $7 " available"}'
elif [ -r /proc/meminfo ]; then
  awk '/MemTotal:/ {printf "%.1f GiB total\n", $2/1024/1024}' /proc/meminfo
else
  printf 'unknown\n'
fi
printf 'Disk: '
df -h / 2>/dev/null | awk 'NR==2 {print $2 " total, " $4 " available on /"}' || printf 'unknown\n'
printf 'Shell: %s\n' "${SHELL:-unknown}"
printf 'Uptime: '
uptime -p 2>/dev/null || uptime 2>/dev/null || printf 'unknown\n'
printf 'Package managers: '
found_pm=''
for pm in apt dnf yum pacman zypper apk brew snap flatpak; do
  if command -v "$pm" >/dev/null 2>&1; then
    if [ -n "$found_pm" ]; then printf ', '; fi
    printf '%s' "$pm"
    found_pm=1
  fi
done
if [ -z "$found_pm" ]; then printf 'unknown'; fi
printf '\n'
printf 'Runtimes: '
found_runtime=''
for runtime in node npm python3 python go rustc cargo docker podman kubectl; do
  if command -v "$runtime" >/dev/null 2>&1; then
    version=$("$runtime" --version 2>/dev/null | head -n 1)
    if [ -n "$found_runtime" ]; then printf '; '; fi
    printf '%s' "${version:-$runtime}"
    found_runtime=1
  fi
done
if [ -z "$found_runtime" ]; then printf 'none detected'; fi
printf '\n'"#
        .to_string()
}

fn required_tmux_session_id(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("tmux session id is required".to_string());
    }
    if trimmed.chars().any(char::is_control) {
        return Err("tmux session id cannot contain control characters".to_string());
    }
    Ok(trimmed.to_string())
}

fn parse_tmux_sessions(output: &str) -> Vec<TmuxSession> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let id = parts.next()?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let attached = parts
                .next()
                .and_then(|value| value.parse::<u32>().ok())
                .is_some_and(|count| count > 0);
            let windows = parts
                .next()
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0);
            let created = parts.next().and_then(|value| value.parse::<u64>().ok());
            let internal_id = parts
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            Some(TmuxSession {
                id,
                attached,
                windows,
                created,
                internal_id,
            })
        })
        .collect()
}

fn command_for(request: &StartTerminalSessionRequest) -> Result<CommandBuilder, String> {
    match request.connection_type.trim().to_lowercase().as_str() {
        "local" => {
            let program = request
                .shell
                .as_ref()
                .map(|shell| shell.trim())
                .filter(|shell| !shell.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| {
                    if cfg!(target_os = "windows") {
                        "powershell.exe".to_string()
                    } else {
                        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
                    }
                });
            let is_cmd = is_windows_cmd_shell(&program);
            let mut command = CommandBuilder::new(resolved_local_shell_program(program));
            if is_cmd {
                command.arg("/D");
            }
            sanitize_windows_local_environment(&mut command);
            set_terminal_environment(&mut command);
            if let Some(directory) = initial_directory_for(request) {
                command.cwd(OsString::from(directory));
            }
            Ok(command)
        }
        "ssh" => {
            let host = request.host.trim();
            if host.is_empty() {
                return Err("host is required for SSH sessions".to_string());
            }

            let mut command = CommandBuilder::new("ssh");
            set_terminal_environment(&mut command);
            command.arg("-tt");
            if let Some(port) = request.port {
                command.arg("-p");
                command.arg(port.to_string());
            }
            if let Some(key_path) = request.key_path.as_ref().map(|value| value.trim()) {
                if !key_path.is_empty() {
                    command.arg("-i");
                    command.arg(key_path);
                }
            }
            if let Some(proxy_jump) = request.proxy_jump.as_ref().map(|value| value.trim()) {
                if !proxy_jump.is_empty() {
                    command.arg("-J");
                    command.arg(proxy_jump);
                }
            }

            let target = match request.user.trim() {
                "" => host.to_string(),
                user => format!("{user}@{host}"),
            };
            command.arg(target);
            if request.use_tmux.unwrap_or(false) {
                if let Some(tmux_session_id) = request
                    .tmux_session_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|session_id| !session_id.is_empty())
                {
                    command.arg(ssh::remote_tmux_resume_command(
                        initial_directory_for(request).as_deref(),
                        tmux_session_id,
                        ssh_buffer_lines_for(request.ssh_buffer_lines),
                    ));
                } else if let Some(directory) = initial_directory_for(request) {
                    command.arg(remote_shell_command_for_initial_directory(&directory));
                }
            } else if let Some(directory) = initial_directory_for(request) {
                command.arg(remote_shell_command_for_initial_directory(&directory));
            }
            Ok(command)
        }
        other => Err(format!(
            "{other} sessions do not have a terminal transport yet"
        )),
    }
}

fn set_terminal_environment(command: &mut CommandBuilder) {
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

fn sanitize_windows_local_environment(command: &mut CommandBuilder) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        const WINDOWS_LOCAL_ENV_ALLOWLIST: &[&str] = &[
            "ALLUSERSPROFILE",
            "APPDATA",
            "CommonProgramFiles",
            "CommonProgramFiles(x86)",
            "ComSpec",
            "HOMEDRIVE",
            "HOMEPATH",
            "LOCALAPPDATA",
            "NUMBER_OF_PROCESSORS",
            "OS",
            "PATH",
            "PATHEXT",
            "PROCESSOR_ARCHITECTURE",
            "PROCESSOR_IDENTIFIER",
            "PROCESSOR_LEVEL",
            "PROCESSOR_REVISION",
            "ProgramData",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "PSModulePath",
            "PUBLIC",
            "SystemDrive",
            "SystemRoot",
            "TEMP",
            "TMP",
            "USERDOMAIN",
            "USERNAME",
            "USERPROFILE",
            "windir",
        ];

        command.env_clear();
        let mut retained = Vec::new();
        for key in WINDOWS_LOCAL_ENV_ALLOWLIST {
            if let Some(value) = std::env::var_os(key) {
                command.env(*key, value);
                retained.push((*key).to_string());
            }
        }
        return retained;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
        Vec::new()
    }
}

fn resolved_local_shell_program(program: String) -> String {
    if is_windows_cmd_shell(&program) {
        windows_cmd_program()
    } else {
        program
    }
}

fn is_windows_cmd_shell(program: &str) -> bool {
    let trimmed = program.trim();
    if trimmed.is_empty() {
        return false;
    }

    let normalized = trimmed.replace('/', "\\").to_ascii_lowercase();
    normalized == "cmd" || normalized == "cmd.exe" || normalized.ends_with("\\cmd.exe")
}

fn windows_cmd_program() -> String {
    std::env::var("ComSpec")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "cmd.exe".to_string())
}

fn initial_directory_for(request: &StartTerminalSessionRequest) -> Option<String> {
    request
        .initial_directory
        .as_deref()
        .map(str::trim)
        .filter(|directory| !directory.is_empty() && *directory != "~")
        .map(str::to_string)
}

fn remote_shell_command_for_initial_directory(directory: &str) -> String {
    format!(
        "cd -- {} && exec \"${{SHELL:-sh}}\" -i",
        shell_single_quote(directory)
    )
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn make_session_id(title: &str) -> String {
    let slug = title
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!(
        "{}-{unique}",
        if slug.is_empty() { "session" } else { &slug }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_request() -> StartTerminalSessionRequest {
        StartTerminalSessionRequest {
            session_id: None,
            title: "Local shell".to_string(),
            connection_type: "local".to_string(),
            host: "localhost".to_string(),
            user: String::new(),
            port: None,
            key_path: None,
            proxy_jump: None,
            auth_method: None,
            secret_owner_id: None,
            shell: None,
            serial_line: None,
            serial_speed: None,
            initial_directory: None,
            cols: None,
            pixel_height: None,
            pixel_width: None,
            rows: None,
            use_tmux: None,
            tmux_session_id: None,
            ssh_buffer_lines: None,
        }
    }

    #[test]
    fn ssh_auth_method_prefers_explicit_agent_and_key_file() {
        let mut request = ssh_request();

        request.auth_method = Some("agent".to_string());
        assert!(matches!(
            ssh_auth_method_for(&request, None),
            Ok(SshAuthMethod::Agent)
        ));

        request.auth_method = Some("keyFile".to_string());
        request.key_path = Some("C:\\Users\\ryan\\.ssh\\id_ed25519".to_string());
        assert!(matches!(
            ssh_auth_method_for(&request, None),
            Ok(SshAuthMethod::KeyFile)
        ));
    }

    #[test]
    fn password_auth_requires_explicit_password_method_before_reading_keychain() {
        let mut request = ssh_request();
        request.auth_method = Some("password".to_string());
        assert!(matches!(
            ssh_auth_method_for(&request, Some("not-for-sqlite")),
            Ok(SshAuthMethod::Password)
        ));

        request.auth_method = Some("keyboardInteractive".to_string());
        assert!(ssh_auth_method_for(&request, None).is_err());
    }

    #[test]
    fn native_auth_errors_fallback_to_interactive_ssh() {
        assert!(should_fallback_to_interactive_ssh(
            "SSH agent authentication was unavailable: Pageant agent failed to list SSH agent identities: early eof"
        ));
        assert!(should_fallback_to_interactive_ssh(
            "SSH key-file authentication failed: invalid key"
        ));
        assert!(should_fallback_to_interactive_ssh(
            "SSH password authentication failed: rejected"
        ));
        assert!(!should_fallback_to_interactive_ssh(
            "SSH host key for example.internal:22 changed"
        ));
        assert!(!should_fallback_to_interactive_ssh(
            "failed to open SSH channel"
        ));
    }

    fn ssh_request() -> StartTerminalSessionRequest {
        StartTerminalSessionRequest {
            session_id: None,
            title: "Test SSH".to_string(),
            connection_type: "ssh".to_string(),
            host: "example.internal".to_string(),
            user: "admin".to_string(),
            port: Some(22),
            key_path: None,
            proxy_jump: None,
            auth_method: None,
            secret_owner_id: None,
            shell: None,
            serial_line: None,
            serial_speed: None,
            initial_directory: None,
            cols: None,
            pixel_height: None,
            pixel_width: None,
            rows: None,
            use_tmux: None,
            tmux_session_id: None,
            ssh_buffer_lines: None,
        }
    }

    #[test]
    fn remote_initial_directory_command_quotes_shell_path() {
        assert_eq!(
            remote_shell_command_for_initial_directory("/srv/releases"),
            "cd -- '/srv/releases' && exec \"${SHELL:-sh}\" -i"
        );
        assert_eq!(
            remote_shell_command_for_initial_directory("/srv/app's current"),
            "cd -- '/srv/app'\\''s current' && exec \"${SHELL:-sh}\" -i"
        );
    }

    #[test]
    fn terminal_commands_advertise_xterm_truecolor_capabilities() {
        let mut command = CommandBuilder::new("shell");
        set_terminal_environment(&mut command);

        assert_eq!(
            command.get_env("TERM").and_then(|value| value.to_str()),
            Some("xterm-256color")
        );
        assert_eq!(
            command
                .get_env("COLORTERM")
                .and_then(|value| value.to_str()),
            Some("truecolor")
        );
    }

    #[test]
    fn recognizes_cmd_shell_names_and_paths() {
        assert!(is_windows_cmd_shell("cmd"));
        assert!(is_windows_cmd_shell("cmd.exe"));
        assert!(is_windows_cmd_shell("C:/Windows/System32/cmd.exe"));
        assert!(is_windows_cmd_shell("C:\\Windows\\System32\\cmd.exe"));
        assert!(!is_windows_cmd_shell("powershell.exe"));
    }

    #[test]
    fn local_cmd_sessions_disable_command_processor_autorun() {
        let mut request = local_request();
        request.shell = Some("cmd.exe".to_string());

        let command = command_for(&request).expect("local cmd command should build");
        let argv = command
            .get_argv()
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(argv, vec![windows_cmd_program(), "/D".to_string()]);
    }

    #[test]
    fn terminal_pty_size_preserves_pixel_dimensions() {
        let mut request = ssh_request();
        request.cols = Some(132);
        request.rows = Some(43);
        request.pixel_width = Some(1200);
        request.pixel_height = Some(720);

        let size = pty_size_for(&request);

        assert_eq!(size.cols, 132);
        assert_eq!(size.rows, 43);
        assert_eq!(size.pixel_width, 1200);
        assert_eq!(size.pixel_height, 720);
    }

    #[test]
    fn tmux_capture_pane_command_targets_session_history() {
        assert_eq!(
            tmux_capture_pane_command("kkterm-test", 5_000),
            "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux capture-pane -p -S -5000 -t 'kkterm-test':"
        );
    }

    #[test]
    fn tmux_capture_pane_command_quotes_session_id() {
        assert_eq!(
            tmux_capture_pane_command("kkterm-test'quoted", 5_000),
            "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux capture-pane -p -S -5000 -t 'kkterm-test'\\''quoted':"
        );
    }

    #[test]
    fn tmux_capture_pane_command_uses_requested_history_limit() {
        assert_eq!(
            tmux_capture_pane_command("kkterm-test", 12_000),
            "if ! command -v tmux >/dev/null 2>&1; then printf 'tmux is not available on the remote host\\n' >&2; exit 127; fi; tmux capture-pane -p -S -12000 -t 'kkterm-test':"
        );
    }

    #[test]
    fn tmux_rename_session_command_quotes_old_and_new_session_ids() {
        assert_eq!(
            tmux_rename_session_command("kkterm-test'old", "kkterm-test'new"),
            "if command -v tmux >/dev/null 2>&1; then tmux rename-session -t 'kkterm-test'\\''old' 'kkterm-test'\\''new'; fi"
        );
    }

    #[test]
    fn parses_loopback_ports_from_ss_output() {
        let output = "\
LISTEN 0 4096 127.0.0.1:3000 0.0.0.0:*
LISTEN 0 4096 0.0.0.0:8080 0.0.0.0:*
LISTEN 0 4096 [::1]:9090 [::]:*
";

        let ports = parse_remote_loopback_ports(output);

        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].port, 3000);
        assert_eq!(ports[1].port, 9090);
    }

    #[test]
    fn parses_loopback_ports_from_lsof_output() {
        let output = "\
COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
node 123 user 21u IPv4 0x0 0t0 TCP 127.0.0.1:5173 (LISTEN)
python 124 user 22u IPv4 0x0 0t0 TCP TCP@localhost:8000 (LISTEN)
";

        let ports = parse_remote_loopback_ports(output);

        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].port, 5173);
        assert_eq!(ports[1].port, 8000);
    }

    #[test]
    fn filters_common_loopback_ports_except_web_ports() {
        let ports = vec![
            RemoteLoopbackPort {
                port: 22,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 53,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 80,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 443,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 1023,
                address: "127.0.0.1".to_string(),
            },
            RemoteLoopbackPort {
                port: 3000,
                address: "127.0.0.1".to_string(),
            },
        ];

        let filtered = filter_remote_loopback_ports(ports, true);

        assert_eq!(
            filtered.iter().map(|entry| entry.port).collect::<Vec<_>>(),
            vec![80, 443, 3000]
        );
    }
}

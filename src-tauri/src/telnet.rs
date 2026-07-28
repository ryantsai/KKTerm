use crate::sessions::emit_terminal_output;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::AppHandle;

const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;

const OPTION_BINARY: u8 = 0;
const OPTION_ECHO: u8 = 1;
const OPTION_SUPPRESS_GO_AHEAD: u8 = 3;
const OPTION_TERMINAL_TYPE: u8 = 24;
const OPTION_NAWS: u8 = 31;
const OPTION_LINEMODE: u8 = 34;

const TERMINAL_TYPE_IS: u8 = 0;
const TERMINAL_TYPE_SEND: u8 = 1;
const TERMINAL_TYPES: [&str; 2] = ["XTERM", "VT100"];

pub struct NativeTelnetTerminal {
    writer: Arc<Mutex<TcpStream>>,
    runtime: Arc<TelnetRuntimeState>,
    session_id: String,
}

#[derive(Clone)]
pub struct NativeTelnetTerminalRequest {
    pub session_id: String,
    pub host: String,
    pub user: String,
    pub port: u16,
    pub password: String,
    pub cols: u16,
    pub rows: u16,
    pub encoding: crate::sessions::TerminalEncodingState,
}

#[derive(Clone, Copy)]
enum TelnetParseState {
    Data,
    Command,
    Option(u8),
    SubnegotiationOption,
    Subnegotiation,
    SubnegotiationCommand,
}

struct TelnetProtocol {
    state: TelnetParseState,
    remote_enabled: HashSet<u8>,
    local_enabled: HashSet<u8>,
    remote_refused: HashSet<u8>,
    local_refused: HashSet<u8>,
    subnegotiation_option: Option<u8>,
    subnegotiation_data: Vec<u8>,
    terminal_type_index: usize,
}

struct TelnetRuntimeState {
    local_binary: AtomicBool,
    naws_enabled: AtomicBool,
    window_size: Mutex<TelnetWindowSize>,
}

#[derive(Clone, Copy)]
struct TelnetWindowSize {
    cols: u16,
    rows: u16,
}

struct TelnetParseResult {
    data: Vec<u8>,
    replies: Vec<u8>,
    events: Vec<TelnetProtocolEvent>,
}

enum TelnetProtocolEvent {
    Negotiation {
        command: u8,
        option: u8,
        action: &'static str,
    },
    TerminalTypeSent {
        terminal_type: &'static str,
    },
    SubnegotiationIgnored {
        option: u8,
        payload_bytes: usize,
    },
}

struct LoginPrompts {
    sent_user: bool,
    sent_password: bool,
    recent_output: String,
}

impl TelnetRuntimeState {
    fn new(cols: u16, rows: u16) -> Self {
        Self {
            local_binary: AtomicBool::new(false),
            naws_enabled: AtomicBool::new(false),
            window_size: Mutex::new(TelnetWindowSize { cols, rows }),
        }
    }

    fn window_size(&self) -> TelnetWindowSize {
        self.window_size
            .lock()
            .map(|size| *size)
            .unwrap_or(TelnetWindowSize { cols: 80, rows: 24 })
    }
}

impl TelnetProtocol {
    fn new() -> Self {
        Self {
            state: TelnetParseState::Data,
            remote_enabled: HashSet::new(),
            local_enabled: HashSet::new(),
            remote_refused: HashSet::new(),
            local_refused: HashSet::new(),
            subnegotiation_option: None,
            subnegotiation_data: Vec::new(),
            terminal_type_index: 0,
        }
    }

    fn receive(&mut self, input: &[u8], runtime: &TelnetRuntimeState) -> TelnetParseResult {
        let mut result = TelnetParseResult {
            data: Vec::with_capacity(input.len()),
            replies: Vec::new(),
            events: Vec::new(),
        };

        for byte in input {
            match self.state {
                TelnetParseState::Data => {
                    if *byte == IAC {
                        self.state = TelnetParseState::Command;
                    } else {
                        result.data.push(*byte);
                    }
                }
                TelnetParseState::Command => match *byte {
                    IAC => {
                        result.data.push(IAC);
                        self.state = TelnetParseState::Data;
                    }
                    WILL | WONT | DO | DONT => self.state = TelnetParseState::Option(*byte),
                    SB => self.state = TelnetParseState::SubnegotiationOption,
                    _ => self.state = TelnetParseState::Data,
                },
                TelnetParseState::Option(command) => {
                    self.handle_negotiation(command, *byte, runtime, &mut result);
                    self.state = TelnetParseState::Data;
                }
                TelnetParseState::SubnegotiationOption => {
                    self.subnegotiation_option = Some(*byte);
                    self.subnegotiation_data.clear();
                    self.state = TelnetParseState::Subnegotiation;
                }
                TelnetParseState::Subnegotiation => {
                    if *byte == IAC {
                        self.state = TelnetParseState::SubnegotiationCommand;
                    } else {
                        self.subnegotiation_data.push(*byte);
                    }
                }
                TelnetParseState::SubnegotiationCommand => match *byte {
                    IAC => {
                        self.subnegotiation_data.push(IAC);
                        self.state = TelnetParseState::Subnegotiation;
                    }
                    SE => {
                        self.handle_subnegotiation(&mut result);
                        self.subnegotiation_option = None;
                        self.subnegotiation_data.clear();
                        self.state = TelnetParseState::Data;
                    }
                    _ => self.state = TelnetParseState::Subnegotiation,
                },
            }
        }

        result
    }

    fn handle_negotiation(
        &mut self,
        command: u8,
        option: u8,
        runtime: &TelnetRuntimeState,
        result: &mut TelnetParseResult,
    ) {
        match command {
            WILL if supports_remote_option(option) => {
                self.remote_refused.remove(&option);
                if self.remote_enabled.insert(option) {
                    result.replies.extend_from_slice(&[IAC, DO, option]);
                    result.events.push(TelnetProtocolEvent::Negotiation {
                        command,
                        option,
                        action: "acceptedRemote",
                    });
                } else {
                    result.events.push(TelnetProtocolEvent::Negotiation {
                        command,
                        option,
                        action: "duplicateIgnored",
                    });
                }
            }
            WILL => {
                if self.remote_refused.insert(option) {
                    result.replies.extend_from_slice(&[IAC, DONT, option]);
                    result.events.push(TelnetProtocolEvent::Negotiation {
                        command,
                        option,
                        action: if option == OPTION_LINEMODE {
                            "refusedForceCharacterMode"
                        } else {
                            "refusedUnsupported"
                        },
                    });
                }
            }
            WONT => {
                let was_enabled = self.remote_enabled.remove(&option);
                self.remote_refused.remove(&option);
                if was_enabled {
                    result.replies.extend_from_slice(&[IAC, DONT, option]);
                }
                result.events.push(TelnetProtocolEvent::Negotiation {
                    command,
                    option,
                    action: "remoteDisabled",
                });
            }
            DO if supports_local_option(option) => {
                self.local_refused.remove(&option);
                if self.local_enabled.insert(option) {
                    result.replies.extend_from_slice(&[IAC, WILL, option]);
                    if option == OPTION_BINARY {
                        runtime.local_binary.store(true, Ordering::Relaxed);
                    } else if option == OPTION_NAWS {
                        runtime.naws_enabled.store(true, Ordering::Relaxed);
                        result
                            .replies
                            .extend_from_slice(&naws_packet(runtime.window_size()));
                    }
                    result.events.push(TelnetProtocolEvent::Negotiation {
                        command,
                        option,
                        action: "enabledLocal",
                    });
                } else {
                    result.events.push(TelnetProtocolEvent::Negotiation {
                        command,
                        option,
                        action: "duplicateIgnored",
                    });
                }
            }
            DO => {
                if self.local_refused.insert(option) {
                    result.replies.extend_from_slice(&[IAC, WONT, option]);
                    result.events.push(TelnetProtocolEvent::Negotiation {
                        command,
                        option,
                        action: if option == OPTION_LINEMODE {
                            "refusedForceCharacterMode"
                        } else {
                            "refusedUnsupported"
                        },
                    });
                }
            }
            DONT => {
                let was_enabled = self.local_enabled.remove(&option);
                self.local_refused.remove(&option);
                if was_enabled {
                    result.replies.extend_from_slice(&[IAC, WONT, option]);
                }
                if option == OPTION_BINARY {
                    runtime.local_binary.store(false, Ordering::Relaxed);
                } else if option == OPTION_NAWS {
                    runtime.naws_enabled.store(false, Ordering::Relaxed);
                }
                result.events.push(TelnetProtocolEvent::Negotiation {
                    command,
                    option,
                    action: "localDisabled",
                });
            }
            _ => {}
        }
    }

    fn handle_subnegotiation(&mut self, result: &mut TelnetParseResult) {
        let Some(option) = self.subnegotiation_option else {
            return;
        };
        if option == OPTION_TERMINAL_TYPE
            && self.local_enabled.contains(&OPTION_TERMINAL_TYPE)
            && self.subnegotiation_data.first() == Some(&TERMINAL_TYPE_SEND)
        {
            let terminal_type =
                TERMINAL_TYPES[self.terminal_type_index.min(TERMINAL_TYPES.len() - 1)];
            self.terminal_type_index = if self.terminal_type_index >= TERMINAL_TYPES.len() {
                0
            } else {
                self.terminal_type_index + 1
            };
            result
                .replies
                .extend_from_slice(&terminal_type_packet(terminal_type));
            result
                .events
                .push(TelnetProtocolEvent::TerminalTypeSent { terminal_type });
        } else {
            result
                .events
                .push(TelnetProtocolEvent::SubnegotiationIgnored {
                    option,
                    payload_bytes: self.subnegotiation_data.len(),
                });
        }
    }
}

impl NativeTelnetTerminal {
    pub fn write_input(&mut self, data: Vec<u8>) -> Result<(), String> {
        let local_binary = self.runtime.local_binary.load(Ordering::Relaxed);
        let encoded = encode_telnet_input(&data, local_binary);
        telnet_debug(
            "terminal.input",
            json!({
                "sessionId": self.session_id,
                "inputBytes": data.len(),
                "wireBytes": encoded.len(),
                "binaryMode": local_binary,
            }),
        );
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "Telnet writer lock is poisoned".to_string())?;
        writer
            .write_all(&encoded)
            .map_err(|error| format!("failed to write Telnet input: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("failed to flush Telnet input: {error}"))
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        if let Ok(mut size) = self.runtime.window_size.lock() {
            *size = TelnetWindowSize { cols, rows };
        }
        let enabled = self.runtime.naws_enabled.load(Ordering::Relaxed);
        telnet_debug(
            "terminal.resize",
            json!({
                "sessionId": self.session_id,
                "cols": cols,
                "rows": rows,
                "nawsEnabled": enabled,
            }),
        );
        if !enabled {
            return Ok(());
        }
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "Telnet writer lock is poisoned".to_string())?;
        writer
            .write_all(&naws_packet(TelnetWindowSize { cols, rows }))
            .map_err(|error| format!("failed to write Telnet window size: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("failed to flush Telnet window size: {error}"))
    }

    pub fn close(self) {
        telnet_debug(
            "terminal.close",
            json!({
                "sessionId": self.session_id,
            }),
        );
        if let Ok(writer) = self.writer.lock() {
            let _ = writer.shutdown(std::net::Shutdown::Both);
        }
    }
}

/// Open a blocking TCP connection for a Telnet session, routing through the
/// global SOCKS5 proxy (Settings → Proxy) when one is configured.
///
/// Telnet uses a blocking `std::net::TcpStream`, so the async SOCKS5 handshake
/// runs on a temporary current-thread runtime (this function is called from a
/// blocking worker) and the tunnel is converted back to a blocking std socket.
fn connect_telnet_stream(host: &str, port: u16) -> Result<TcpStream, String> {
    if let Some(proxy) = crate::net::proxy::socks_endpoint() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| format!("failed to create Telnet SOCKS runtime: {error}"))?;
        let tunnel = runtime.block_on(crate::socks::connect_via_socks5(&proxy, host, port))?;
        let stream = tunnel
            .into_std()
            .map_err(|error| format!("failed to adopt Telnet SOCKS stream: {error}"))?;
        stream
            .set_nonblocking(false)
            .map_err(|error| format!("failed to configure Telnet SOCKS stream: {error}"))?;
        return Ok(stream);
    }

    let address = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("failed to resolve Telnet host {host}: {error}"))?
        .next()
        .ok_or_else(|| format!("Telnet host {host} did not resolve to an address"))?;
    TcpStream::connect_timeout(&address, Duration::from_secs(10))
        .map_err(|error| format!("failed to connect Telnet session: {error}"))
}

pub fn start_native_terminal(
    app: AppHandle,
    request: NativeTelnetTerminalRequest,
) -> Result<NativeTelnetTerminal, String> {
    let host = request.host.trim();
    if host.is_empty() {
        return Err("host is required for Telnet sessions".to_string());
    }
    if request.user.trim().is_empty() {
        return Err("user is required for Telnet sessions".to_string());
    }

    telnet_debug(
        "terminal.startup.begin",
        json!({
            "sessionId": request.session_id,
            "host": host,
            "port": request.port,
            "user": request.user,
            "cols": request.cols,
            "rows": request.rows,
            "terminalTypes": TERMINAL_TYPES,
        }),
    );
    let stream = connect_telnet_stream(host, request.port)?;
    stream
        .set_nodelay(true)
        .map_err(|error| format!("failed to configure Telnet socket: {error}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|error| format!("failed to configure Telnet read timeout: {error}"))?;

    let mut reader = stream
        .try_clone()
        .map_err(|error| format!("failed to create Telnet reader: {error}"))?;
    let writer =
        Arc::new(Mutex::new(stream.try_clone().map_err(|error| {
            format!("failed to create Telnet writer: {error}")
        })?));
    let reader_writer = Arc::clone(&writer);
    let runtime = Arc::new(TelnetRuntimeState::new(request.cols, request.rows));
    let reader_runtime = Arc::clone(&runtime);
    let reader_session_id = request.session_id.clone();
    let terminal_session_id = request.session_id.clone();
    telnet_debug(
        "terminal.connected",
        json!({
            "sessionId": request.session_id,
            "remoteAddress": format!("{host}:{}", request.port),
        }),
    );
    std::thread::spawn(move || {
        let mut protocol = TelnetProtocol::new();
        let mut prompts = LoginPrompts {
            sent_user: false,
            sent_password: false,
            recent_output: String::new(),
        };
        let mut buffer = [0_u8; 8192];
        let mut output_decoder =
            crate::sessions::TerminalOutputDecoder::new(request.encoding.clone());
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    if let Some(text) = output_decoder.finish_lossy() {
                        emit_terminal_output(&app, &request.session_id, text);
                    }
                    telnet_debug(
                        "terminal.remote_closed",
                        json!({ "sessionId": reader_session_id }),
                    );
                    break;
                }
                Ok(count) => {
                    let parsed = protocol.receive(&buffer[..count], &reader_runtime);
                    log_protocol_events(&reader_session_id, &parsed.events);
                    telnet_debug(
                        "terminal.output",
                        json!({
                            "sessionId": reader_session_id,
                            "wireBytes": count,
                            "terminalBytes": parsed.data.len(),
                            "replyBytes": parsed.replies.len(),
                        }),
                    );
                    if !parsed.replies.is_empty() {
                        let write_result = reader_writer
                            .lock()
                            .map_err(|_| "Telnet writer lock is poisoned".to_string())
                            .and_then(|mut writer| {
                                writer
                                    .write_all(&parsed.replies)
                                    .and_then(|_| writer.flush())
                                    .map_err(|error| error.to_string())
                            });
                        if let Err(error) = write_result {
                            telnet_debug(
                                "terminal.negotiation_write_error",
                                json!({
                                    "sessionId": reader_session_id,
                                    "error": error.to_string(),
                                }),
                            );
                            break;
                        }
                    }
                    if !parsed.data.is_empty() {
                        if let Ok(mut writer) = reader_writer.lock() {
                            maybe_answer_login_prompt(
                                &mut writer,
                                &request,
                                &mut prompts,
                                &parsed.data,
                            );
                        }
                        if let Some(text) = output_decoder.decode(&parsed.data) {
                            emit_terminal_output(&app, &request.session_id, text);
                        }
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    continue;
                }
                Err(error) => {
                    if let Some(text) = output_decoder.finish_lossy() {
                        emit_terminal_output(&app, &request.session_id, text);
                    }
                    telnet_debug(
                        "terminal.read_error",
                        json!({
                            "sessionId": reader_session_id,
                            "error": error.to_string(),
                        }),
                    );
                    emit_terminal_output(
                        &app,
                        &request.session_id,
                        format!("\r\n[Telnet read error: {error}]\r\n"),
                    );
                    break;
                }
            }
        }
        crate::sessions::emit_terminal_session_ended(&app, &reader_session_id);
    });

    Ok(NativeTelnetTerminal {
        writer,
        runtime,
        session_id: terminal_session_id,
    })
}

fn supports_remote_option(option: u8) -> bool {
    matches!(
        option,
        OPTION_BINARY | OPTION_ECHO | OPTION_SUPPRESS_GO_AHEAD
    )
}

fn supports_local_option(option: u8) -> bool {
    matches!(
        option,
        OPTION_BINARY | OPTION_SUPPRESS_GO_AHEAD | OPTION_TERMINAL_TYPE | OPTION_NAWS
    )
}

fn encode_telnet_input(input: &[u8], binary_mode: bool) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len());
    for (index, byte) in input.iter().enumerate() {
        let previous_was_cr = index > 0 && input[index - 1] == b'\r';
        let next_is_lf = input.get(index + 1) == Some(&b'\n');
        if !binary_mode && *byte == b'\n' && !previous_was_cr {
            output.push(b'\r');
        }
        if *byte == IAC {
            output.push(IAC);
        }
        output.push(*byte);
        if !binary_mode && *byte == b'\r' && !next_is_lf {
            output.push(0);
        }
    }
    output
}

fn terminal_type_packet(terminal_type: &str) -> Vec<u8> {
    let mut packet = vec![IAC, SB, OPTION_TERMINAL_TYPE, TERMINAL_TYPE_IS];
    for byte in terminal_type.as_bytes() {
        packet.push(*byte);
        if *byte == IAC {
            packet.push(IAC);
        }
    }
    packet.extend_from_slice(&[IAC, SE]);
    packet
}

fn naws_packet(size: TelnetWindowSize) -> Vec<u8> {
    let mut packet = vec![IAC, SB, OPTION_NAWS];
    for byte in [
        (size.cols >> 8) as u8,
        size.cols as u8,
        (size.rows >> 8) as u8,
        size.rows as u8,
    ] {
        packet.push(byte);
        if byte == IAC {
            packet.push(IAC);
        }
    }
    packet.extend_from_slice(&[IAC, SE]);
    packet
}

fn telnet_debug(event: &str, payload: Value) {
    crate::logging::telnet_debug(event, &payload);
}

fn log_protocol_events(session_id: &str, events: &[TelnetProtocolEvent]) {
    for event in events {
        match event {
            TelnetProtocolEvent::Negotiation {
                command,
                option,
                action,
            } => telnet_debug(
                "protocol.negotiation",
                json!({
                    "sessionId": session_id,
                    "command": command_name(*command),
                    "option": option_name(*option),
                    "optionCode": option,
                    "action": action,
                }),
            ),
            TelnetProtocolEvent::TerminalTypeSent { terminal_type } => telnet_debug(
                "protocol.terminal_type.sent",
                json!({
                    "sessionId": session_id,
                    "terminalType": terminal_type,
                }),
            ),
            TelnetProtocolEvent::SubnegotiationIgnored {
                option,
                payload_bytes,
            } => telnet_debug(
                "protocol.subnegotiation.ignored",
                json!({
                    "sessionId": session_id,
                    "option": option_name(*option),
                    "optionCode": option,
                    "payloadBytes": payload_bytes,
                }),
            ),
        }
    }
}

fn command_name(command: u8) -> &'static str {
    match command {
        WILL => "WILL",
        WONT => "WONT",
        DO => "DO",
        DONT => "DONT",
        _ => "UNKNOWN",
    }
}

fn option_name(option: u8) -> &'static str {
    match option {
        OPTION_BINARY => "BINARY",
        OPTION_ECHO => "ECHO",
        OPTION_SUPPRESS_GO_AHEAD => "SUPPRESS-GO-AHEAD",
        OPTION_TERMINAL_TYPE => "TERMINAL-TYPE",
        OPTION_NAWS => "NAWS",
        OPTION_LINEMODE => "LINEMODE",
        _ => "UNKNOWN",
    }
}

fn maybe_answer_login_prompt(
    writer: &mut TcpStream,
    request: &NativeTelnetTerminalRequest,
    prompts: &mut LoginPrompts,
    data: &[u8],
) {
    prompts
        .recent_output
        .push_str(&String::from_utf8_lossy(data).to_lowercase());
    if prompts.recent_output.len() > 2048 {
        let keep_from = prompts.recent_output.len().saturating_sub(1024);
        prompts.recent_output = prompts.recent_output[keep_from..].to_string();
    }

    if !prompts.sent_user
        && (prompts.recent_output.contains("login:") || prompts.recent_output.contains("username:"))
    {
        let _ = writer.write_all(format!("{}\r\n", request.user.trim()).as_bytes());
        let _ = writer.flush();
        prompts.sent_user = true;
        prompts.recent_output.clear();
        telnet_debug(
            "login.username.sent",
            json!({ "sessionId": request.session_id }),
        );
        return;
    }

    // With no stored password, leave the remote password prompt for the user to
    // answer interactively in the terminal.
    if !request.password.is_empty()
        && prompts.sent_user
        && !prompts.sent_password
        && prompts.recent_output.contains("password:")
    {
        let _ = writer.write_all(format!("{}\r\n", request.password).as_bytes());
        let _ = writer.flush();
        prompts.sent_password = true;
        prompts.recent_output.clear();
        telnet_debug(
            "login.password.sent",
            json!({ "sessionId": request.session_id }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telnet_parser_accepts_interactive_options_without_reply_loops() {
        let runtime = TelnetRuntimeState::new(80, 24);
        let mut protocol = TelnetProtocol::new();
        let parsed = protocol.receive(
            &[
                b'h',
                b'i',
                IAC,
                WILL,
                OPTION_ECHO,
                IAC,
                DO,
                OPTION_SUPPRESS_GO_AHEAD,
                b'!',
            ],
            &runtime,
        );

        assert_eq!(parsed.data, b"hi!");
        assert_eq!(
            parsed.replies,
            vec![IAC, DO, OPTION_ECHO, IAC, WILL, OPTION_SUPPRESS_GO_AHEAD]
        );

        let repeated = protocol.receive(
            &[IAC, WILL, OPTION_ECHO, IAC, DO, OPTION_SUPPRESS_GO_AHEAD],
            &runtime,
        );
        assert!(repeated.replies.is_empty());
    }

    #[test]
    fn telnet_parser_preserves_escaped_iac_data() {
        let runtime = TelnetRuntimeState::new(80, 24);
        let mut protocol = TelnetProtocol::new();
        let parsed = protocol.receive(&[b'a', IAC, IAC, b'b'], &runtime);

        assert_eq!(parsed.data, vec![b'a', IAC, b'b']);
        assert!(parsed.replies.is_empty());
    }

    #[test]
    fn telnet_parser_refuses_unknown_options_once_and_allows_renegotiation() {
        let runtime = TelnetRuntimeState::new(80, 24);
        let mut protocol = TelnetProtocol::new();

        let first = protocol.receive(&[IAC, WILL, 99, IAC, DO, OPTION_LINEMODE], &runtime);
        assert_eq!(
            first.replies,
            vec![IAC, DONT, 99, IAC, WONT, OPTION_LINEMODE]
        );
        assert!(
            protocol
                .receive(&[IAC, WILL, 99, IAC, DO, OPTION_LINEMODE], &runtime)
                .replies
                .is_empty()
        );

        protocol.receive(&[IAC, WONT, 99, IAC, DONT, OPTION_LINEMODE], &runtime);
        assert_eq!(
            protocol
                .receive(&[IAC, WILL, 99, IAC, DO, OPTION_LINEMODE], &runtime)
                .replies,
            vec![IAC, DONT, 99, IAC, WONT, OPTION_LINEMODE]
        );
    }

    #[test]
    fn telnet_parser_acknowledges_disabling_enabled_options_once() {
        let runtime = TelnetRuntimeState::new(80, 24);
        let mut protocol = TelnetProtocol::new();
        protocol.receive(&[IAC, WILL, OPTION_ECHO, IAC, DO, OPTION_BINARY], &runtime);

        let disabled = protocol.receive(
            &[IAC, WONT, OPTION_ECHO, IAC, DONT, OPTION_BINARY],
            &runtime,
        );
        assert_eq!(
            disabled.replies,
            vec![IAC, DONT, OPTION_ECHO, IAC, WONT, OPTION_BINARY]
        );
        assert!(!runtime.local_binary.load(Ordering::Relaxed));
        assert!(
            protocol
                .receive(
                    &[IAC, WONT, OPTION_ECHO, IAC, DONT, OPTION_BINARY],
                    &runtime,
                )
                .replies
                .is_empty()
        );
    }

    #[test]
    fn telnet_parser_cycles_xterm_then_vt100_for_terminal_type_requests() {
        let runtime = TelnetRuntimeState::new(80, 24);
        let mut protocol = TelnetProtocol::new();
        assert_eq!(
            protocol
                .receive(&[IAC, DO, OPTION_TERMINAL_TYPE], &runtime)
                .replies,
            vec![IAC, WILL, OPTION_TERMINAL_TYPE]
        );

        let request = [IAC, SB, OPTION_TERMINAL_TYPE, TERMINAL_TYPE_SEND, IAC, SE];
        assert_eq!(
            protocol.receive(&request[..3], &runtime).replies,
            Vec::<u8>::new()
        );
        assert_eq!(
            protocol.receive(&request[3..], &runtime).replies,
            terminal_type_packet("XTERM")
        );
        assert_eq!(
            protocol.receive(&request, &runtime).replies,
            terminal_type_packet("VT100")
        );
        assert_eq!(
            protocol.receive(&request, &runtime).replies,
            terminal_type_packet("VT100")
        );
        assert_eq!(
            protocol.receive(&request, &runtime).replies,
            terminal_type_packet("XTERM")
        );
    }

    #[test]
    fn telnet_parser_sends_initial_naws_and_escapes_iac_size_bytes() {
        let runtime = TelnetRuntimeState::new(255, 511);
        let mut protocol = TelnetProtocol::new();
        let parsed = protocol.receive(&[IAC, DO, OPTION_NAWS], &runtime);

        assert_eq!(
            parsed.replies,
            vec![
                IAC,
                WILL,
                OPTION_NAWS,
                IAC,
                SB,
                OPTION_NAWS,
                0,
                IAC,
                IAC,
                1,
                IAC,
                IAC,
                IAC,
                SE
            ]
        );
        assert!(runtime.naws_enabled.load(Ordering::Relaxed));
    }

    #[test]
    fn telnet_input_uses_nvt_newlines_and_escapes_iac_until_binary_is_enabled() {
        assert_eq!(
            encode_telnet_input(&[b'a', b'\r', b'\n', IAC], false),
            vec![b'a', b'\r', b'\n', IAC, IAC]
        );
        assert_eq!(encode_telnet_input(&[b'\r'], false), vec![b'\r', 0]);
        assert_eq!(
            encode_telnet_input(&[b'a', b'\r', b'\n', IAC], true),
            vec![b'a', b'\r', b'\n', IAC, IAC]
        );
    }
}

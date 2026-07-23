//! macOS RDP client built on IronRDP. Decodes the RDP framebuffer to RGBA and
//! emits `rdp-canvas-event`s for the workspace canvas. Windows uses the native
//! ActiveX path in `rdp.rs` instead; this module is compiled only off-Windows.
//!
//! # Pinned IronRDP connect sequence (verified against ironrdp 0.15 / ironrdp-tokio 0.9)
//!
//! ## Dependencies used
//! - `ironrdp = "0.15"` with features `["connector", "session", "graphics", "pdu", "input"]`
//! - `ironrdp-tokio = "0.9"` (re-exports all of `ironrdp_async` via `pub use ironrdp_async::*`)
//! - `tokio-rustls = "0.26"` (for TLS upgrade — we implement the upgrade directly, no ironrdp-tls)
//! - `tokio-native-tls = "0.3"` (legacy TLS fallback for old Windows hosts; see `RdpTlsStream`)
//! - `sspi = "0.21"` (for CredSSP/NTLM)
//!
//! ## Key types
//! ```text
//! // TokioFramed<S> = Framed<TokioStream<S>>
//! // Framed::new(stream: S::InnerStream) -> Self
//! // TokioStream<S>::InnerStream = S  =>  TokioFramed::new(tcp_stream) works directly
//! ironrdp_tokio::TokioFramed<tokio::net::TcpStream>  // pre-TLS
//! ironrdp_tokio::TokioFramed<RdpTlsStream>           // post-TLS (concrete; see UpgradedFramed)
//! ironrdp::connector::ClientConnector  // config: connector::Config, client_addr: SocketAddr
//! ironrdp::connector::ConnectionResult  // returned by connect_finalize on success
//! ```
//!
//! ## Connect sequence (exact function paths, all from ironrdp_tokio namespace)
//! ```text
//! // Step 1: TCP connect + create framed
//! let stream = tokio::net::TcpStream::connect((host, port)).await?;
//! let client_addr = stream.local_addr()?;
//! let mut framed = ironrdp_tokio::TokioFramed::new(stream);
//!
//! // Step 2: Create connector
//! let mut connector = ironrdp::connector::ClientConnector::new(config, client_addr);
//!
//! // Step 3: Begin connection (negotiation / NLA pre-TLS handshake)
//! let should_upgrade = ironrdp_tokio::connect_begin(&mut framed, &mut connector).await?;
//!
//! // Step 4: Extract inner TCP stream + any leftover bytes
//! let (initial_stream, leftover_bytes) = framed.into_inner();
//!
//! // Step 5: TLS upgrade via tokio-rustls. If the rustls handshake itself
//! // fails (old Windows Schannel with no cipher overlap resets the TCP
//! // connection), the whole sequence is retried once from Step 1 with the
//! // platform TLS stack via tokio-native-tls, which still speaks TLS 1.0-1.2
//! // with the legacy CBC/RSA suites (see rdp_connect / RdpTlsStream).
//! let tls_stream = tls_upgrade(initial_stream, &host).await?;
//!
//! // Step 6: Extract server public key
//! let server_public_key = extract_server_public_key(&tls_stream)?;
//!
//! // Step 7: Mark as upgraded
//! let upgraded = ironrdp_tokio::mark_as_upgraded(should_upgrade, &mut connector);
//!
//! // Step 8: Create upgraded framed over the concrete TLS stream (kept concrete,
//! // not box-erased, so the spawned session future stays `Send`).
//! let mut upgraded_framed = ironrdp_tokio::TokioFramed::new_with_leftover(tls_stream, leftover_bytes);
//!
//! // Step 9: Finalize connection
//! let connection_result = ironrdp_tokio::connect_finalize(
//!     upgraded, connector, &mut upgraded_framed, &mut NoopNetworkClient,
//!     ServerName::new(host), server_public_key, None,
//! ).await?;
//! ```

use crate::logging::rdp_debug;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use ironrdp::cliprdr::{
    CliprdrClient,
    backend::CliprdrBackend,
    pdu::{
        ClipboardFormat, ClipboardFormatId, ClipboardGeneralCapabilityFlags, FileContentsRequest,
        FileContentsResponse, FormatDataRequest, FormatDataResponse, LockDataId,
        OwnedFormatDataResponse,
    },
};
use ironrdp::core::{AsAny, IntoOwned};
use ironrdp::rdpdr::{
    Rdpdr, RdpdrBackend,
    pdu::efs::{
        DeviceControlRequest, FileInformationClass, ServerDeviceAnnounceResponse,
        ServerDriveIoRequest,
    },
    pdu::esc::{ScardCall, ScardIoCtlCode},
};
use ironrdp::rdpsnd::client::{NoopRdpsndBackend, Rdpsnd};
use ironrdp_rdpdr_native::backend::NixRdpdrBackend;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};
use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpStream,
    runtime::Runtime,
    sync::{mpsc, oneshot},
};

const DEFAULT_RDP_PORT: u16 = 3389;
const DEFAULT_RDP_WIDTH: u16 = 1280;
const DEFAULT_RDP_HEIGHT: u16 = 800;

// ── Session manager ───────────────────────────────────────────────────────────

pub struct RdpClientSessionManager {
    runtime: Runtime,
    sessions: Mutex<HashMap<String, RdpClientSession>>,
}

struct RdpClientSession {
    input: mpsc::UnboundedSender<RdpInput>,
    stop: Option<oneshot::Sender<()>>,
    connected: bool,
}

/// Input operations queued from the frontend, translated to IronRDP input in
/// the event loop (Task 4/5).
enum RdpInput {
    Pointer {
        x: u16,
        y: u16,
        button_mask: u8,
    },
    Key {
        scancode: u16,
        down: bool,
    },
    /// Composed text (IME / printable characters) sent as RDP Unicode keyboard
    /// events — layout- and IME-independent, unlike scancodes.
    Text(String),
    LocalClipboardText(String),
    PasteLocalClipboardText(String),
    CtrlAltDelete,
    /// Re-emit the current framebuffer as one full-desktop RawImage. Used when a
    /// detached full-screen window attaches to a live session and needs an
    /// immediate repaint (the server only sends deltas). This never touches the
    /// RDP wire; it replays IronRDP's already-decoded image.
    ResendFullFrame,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRdpClientSessionRequest {
    session_id: String,
    host: String,
    port: Option<u16>,
    username: String,
    #[serde(default)]
    domain: Option<String>,
    secret_owner_id: Option<String>,
    password: Option<String>,
    #[serde(default)]
    desktop_width: Option<u16>,
    #[serde(default)]
    desktop_height: Option<u16>,
    #[serde(default)]
    administrative_session: bool,
    #[serde(default)]
    shared_local_folders: Vec<String>,
    #[serde(default)]
    shared_local_folder: Option<String>,
}

impl StartRdpClientSessionRequest {
    fn desktop_width(&self) -> u16 {
        self.desktop_width
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_RDP_WIDTH)
    }
    fn desktop_height(&self) -> u16 {
        self.desktop_height
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_RDP_HEIGHT)
    }
    pub(crate) fn secret_owner_id(&self) -> Option<&str> {
        self.secret_owner_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
    }
    pub(crate) fn password(&self) -> Option<&str> {
        self.password.as_deref().filter(|v| !v.is_empty())
    }
    pub(crate) fn set_password(&mut self, password: Option<String>) {
        self.password = password;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpClientSessionStarted {
    session_id: String,
    host: String,
    port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpClientSessionStatus {
    session_id: String,
    connected: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpClientPointerEventRequest {
    session_id: String,
    x: u16,
    y: u16,
    button_mask: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpClientKeyEventRequest {
    session_id: String,
    scancode: u16,
    down: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpClientTextRequest {
    session_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpClientSimpleRequest {
    session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
enum RdpCanvasEvent {
    Connected {
        session_id: String,
        name: String,
    },
    Resolution {
        session_id: String,
        width: u16,
        height: u16,
    },
    RawImage {
        session_id: String,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        rgba: String,
    },
    SetCursor {
        session_id: String,
        width: u16,
        height: u16,
        hot_x: u16,
        hot_y: u16,
        rgba: String,
    },
    Error {
        session_id: String,
        message: String,
    },
    Disconnected {
        session_id: String,
    },
    ClipboardText {
        session_id: String,
        text: String,
    },
}

impl RdpClientSessionManager {
    pub fn new() -> Self {
        Self {
            runtime: Runtime::new().expect("RDP client runtime initializes"),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_session(
        &self,
        app: AppHandle,
        request: StartRdpClientSessionRequest,
    ) -> Result<RdpClientSessionStarted, String> {
        let session_id = required_id(request.session_id.clone())?;
        let host = {
            let h = request.host.trim().to_string();
            if h.is_empty() {
                return Err("RDP host is required".to_string());
            }
            h
        };
        let port = request.port.unwrap_or(DEFAULT_RDP_PORT);
        if port == 0 {
            return Err("RDP port must be between 1 and 65535".to_string());
        }

        {
            let sessions = self.lock_sessions()?;
            if sessions.contains_key(&session_id) {
                return Err(format!("RDP session '{session_id}' is already running"));
            }
        }

        let width = request.desktop_width();
        let height = request.desktop_height();
        let username = request.username.clone();
        let password = request.password.clone().unwrap_or_default();
        let domain = request.domain.clone();
        let shared_local_folders = validate_shared_local_folders(
            &request.shared_local_folders,
            request.shared_local_folder.as_deref(),
        )?;

        rdp_debug(
            "ironrdp.start.request",
            &rdp_client_start_debug_payload(
                &session_id,
                &host,
                port,
                &username,
                domain.as_deref(),
                width,
                height,
                request.administrative_session,
                shared_local_folders.len(),
            ),
        );

        let (connection_result, framed) = match self.runtime.block_on(rdp_connect(
            app.clone(),
            session_id.clone(),
            host.clone(),
            port,
            username,
            password,
            domain,
            width,
            height,
            request.administrative_session,
            shared_local_folders,
        )) {
            Ok(result) => result,
            Err(error) => {
                rdp_debug(
                    "ironrdp.start.error",
                    &json!({
                        "sessionId": session_id,
                        "host": host,
                        "port": port,
                        "error": error,
                    }),
                );
                return Err(format!("RDP connect failed: {error}"));
            }
        };

        rdp_debug(
            "ironrdp.start.ok",
            &json!({
                "sessionId": session_id,
                "host": host,
                "port": port,
                "desktopWidth": connection_result.desktop_size.width,
                "desktopHeight": connection_result.desktop_size.height,
            }),
        );

        let (stop_tx, stop_rx) = oneshot::channel();
        let (input_tx, input_rx) = mpsc::unbounded_channel();

        spawn_rdp_event_loop(
            &self.runtime,
            app,
            session_id.clone(),
            connection_result,
            framed,
            input_rx,
            stop_rx,
        );

        let mut sessions = self.lock_sessions()?;
        sessions.insert(
            session_id.clone(),
            RdpClientSession {
                input: input_tx,
                stop: Some(stop_tx),
                connected: true,
            },
        );

        Ok(RdpClientSessionStarted {
            session_id,
            host,
            port,
        })
    }

    pub fn pointer_event(&self, request: RdpClientPointerEventRequest) -> Result<(), String> {
        self.queue_input(
            &request.session_id,
            RdpInput::Pointer {
                x: request.x,
                y: request.y,
                button_mask: request.button_mask,
            },
        )
    }

    pub fn key_event(&self, request: RdpClientKeyEventRequest) -> Result<(), String> {
        self.queue_input(
            &request.session_id,
            RdpInput::Key {
                scancode: request.scancode,
                down: request.down,
            },
        )
    }

    pub fn text_input(&self, request: RdpClientTextRequest) -> Result<(), String> {
        self.queue_input(&request.session_id, RdpInput::Text(request.text))
    }

    pub fn clipboard_text(&self, request: RdpClientTextRequest) -> Result<(), String> {
        self.queue_input(
            &request.session_id,
            RdpInput::LocalClipboardText(request.text),
        )
    }

    pub fn paste_clipboard(&self, request: RdpClientSimpleRequest) -> Result<(), String> {
        let text = read_system_clipboard_text().map_err(|error| {
            rdp_debug(
                "ironrdp.clipboard.native_read_error",
                &json!({
                    "sessionId": request.session_id,
                    "error": error,
                }),
            );
            error
        })?;
        rdp_debug(
            "ironrdp.clipboard.native_read",
            &json!({
                "sessionId": request.session_id,
                "characterCount": text.chars().count(),
            }),
        );
        if text.is_empty() {
            return Ok(());
        }
        self.queue_input(&request.session_id, RdpInput::PasteLocalClipboardText(text))
    }

    pub fn send_ctrl_alt_delete(&self, request: RdpClientSimpleRequest) -> Result<(), String> {
        self.queue_input(&request.session_id, RdpInput::CtrlAltDelete)
    }

    /// Request a full-frame repaint (used when a detached full-screen window
    /// attaches to a running session).
    pub fn refresh(&self, request: RdpClientSimpleRequest) -> Result<(), String> {
        self.queue_input(&request.session_id, RdpInput::ResendFullFrame)
    }

    pub fn close_session(&self, request: RdpClientSimpleRequest) -> Result<(), String> {
        let removed = {
            let mut sessions = self.lock_sessions()?;
            sessions.remove(&request.session_id)
        };
        if let Some(mut session) = removed {
            if let Some(stop) = session.stop.take() {
                let _ = stop.send(());
            }
        }
        Ok(())
    }

    pub fn session_status(
        &self,
        request: RdpClientSimpleRequest,
    ) -> Result<RdpClientSessionStatus, String> {
        let sessions = self.lock_sessions()?;
        let connected = sessions
            .get(&request.session_id)
            .map(|s| s.connected)
            .unwrap_or(false);
        Ok(RdpClientSessionStatus {
            session_id: request.session_id,
            connected,
        })
    }

    fn queue_input(&self, session_id: &str, input: RdpInput) -> Result<(), String> {
        let sessions = self.lock_sessions()?;
        let tx = sessions
            .get(session_id)
            .map(|s| s.input.clone())
            .ok_or_else(|| format!("RDP session '{session_id}' was not found"))?;
        tx.send(input)
            .map_err(|_| format!("RDP session '{session_id}' input channel is closed"))
    }

    fn lock_sessions(&self) -> Result<MutexGuard<'_, HashMap<String, RdpClientSession>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "RDP session lock is poisoned".to_string())
    }
}

fn rdp_client_start_debug_payload(
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    domain: Option<&str>,
    desktop_width: u16,
    desktop_height: u16,
    administrative_session: bool,
    shared_local_folder_count: usize,
) -> Value {
    json!({
        "sessionId": session_id,
        "host": host,
        "port": port,
        "username": username,
        "domain": domain,
        "desktopWidth": desktop_width,
        "desktopHeight": desktop_height,
        "administrativeSession": administrative_session,
        "sharedLocalFolderCount": shared_local_folder_count,
        "security": {
            "enableCredSsp": true,
            "enableTls": false,
            "requestedProtocols": ["HYBRID", "HYBRID_EX"],
            "legacyTlsFallbackAllowed": true,
        },
    })
}

// ── No-op NetworkClient (safe for NTLM; Kerberos KDC round-trips never happen) ──

struct NoopNetworkClient;

impl ironrdp_tokio::NetworkClient for NoopNetworkClient {
    async fn send(
        &mut self,
        _request: &ironrdp::connector::sspi::generator::NetworkRequest,
    ) -> ironrdp::connector::ConnectorResult<Vec<u8>> {
        Err(ironrdp::connector::general_err!(
            "no KDC network client; use NTLM credentials not Kerberos"
        ))
    }
}

// ── TLS: NoCertificateVerification (RDP never verifies the cert chain) ────────

#[derive(Debug)]
struct NoCertificateVerification(Arc<rustls::crypto::CryptoProvider>);

impl rustls::client::danger::ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dsa: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dsa,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dsa: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dsa,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

// ── TLS stream: rustls with a legacy native-tls fallback (issue #344) ─────────

/// Which TLS implementation performs the security upgrade.
#[derive(Clone, Copy, PartialEq, Eq)]
enum TlsBackend {
    /// Modern path: TLS 1.2/1.3, ECDHE + AEAD cipher suites only.
    Rustls,
    /// Legacy fallback via the platform TLS stack (SecureTransport on macOS,
    /// OpenSSL on Linux). Old Windows Schannel configs — Win7/Server 2008 R2
    /// (TLS 1.0 only by default) and Server 2012/2012 R2 (only CBC suites with
    /// the RSA certs RDP uses) — have zero cipher overlap with rustls and
    /// reset the TCP connection mid-handshake ("connection reset by peer").
    /// The platform stacks still speak those suites, like mstsc does.
    NativeTls,
}

impl TlsBackend {
    fn label(self) -> &'static str {
        match self {
            Self::Rustls => "rustls",
            Self::NativeTls => "native-tls",
        }
    }
}

/// The upgraded RDP stream, over either TLS backend. Kept as a concrete enum
/// (not box-erased) so the spawned session future stays `Send`.
enum RdpTlsStream {
    Rustls(Box<tokio_rustls::client::TlsStream<TcpStream>>),
    NativeTls(tokio_native_tls::TlsStream<TcpStream>),
}

impl tokio::io::AsyncRead for RdpTlsStream {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Rustls(stream) => std::pin::Pin::new(stream).poll_read(cx, buf),
            Self::NativeTls(stream) => std::pin::Pin::new(stream).poll_read(cx, buf),
        }
    }
}

impl tokio::io::AsyncWrite for RdpTlsStream {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        match self.get_mut() {
            Self::Rustls(stream) => std::pin::Pin::new(stream).poll_write(cx, buf),
            Self::NativeTls(stream) => std::pin::Pin::new(stream).poll_write(cx, buf),
        }
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Rustls(stream) => std::pin::Pin::new(stream).poll_flush(cx),
            Self::NativeTls(stream) => std::pin::Pin::new(stream).poll_flush(cx),
        }
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Rustls(stream) => std::pin::Pin::new(stream).poll_shutdown(cx),
            Self::NativeTls(stream) => std::pin::Pin::new(stream).poll_shutdown(cx),
        }
    }
}

async fn tls_upgrade(
    stream: TcpStream,
    session_id: &str,
    host: &str,
    port: u16,
    server_name: &str,
    backend: TlsBackend,
) -> Result<RdpTlsStream, String> {
    match backend {
        TlsBackend::Rustls => tls_upgrade_rustls(stream, session_id, host, port, server_name).await,
        TlsBackend::NativeTls => {
            tls_upgrade_native(stream, session_id, host, port, server_name).await
        }
    }
}

async fn tls_upgrade_native(
    stream: TcpStream,
    session_id: &str,
    host: &str,
    port: u16,
    server_name: &str,
) -> Result<RdpTlsStream, String> {
    use tokio_native_tls::native_tls;

    rdp_debug(
        "ironrdp.tls.start",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
            "serverName": server_name,
            "backend": TlsBackend::NativeTls.label(),
            "protocolVersions": ["TLS1.0", "TLS1.1", "TLS1.2"],
            "certificateVerification": "disabled_for_rdp",
        }),
    );

    let connector = native_tls::TlsConnector::builder()
        // RDP wraps its own CredSSP auth inside TLS; chain/hostname
        // verification is intentionally skipped, same as the rustls path.
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        // The whole point of this fallback is legacy protocol support.
        .min_protocol_version(Some(native_tls::Protocol::Tlsv10))
        .build()
        .map_err(|e| format!("TLS config error: {e}"))?;
    let connector = tokio_native_tls::TlsConnector::from(connector);

    match connector.connect(server_name, stream).await {
        Ok(tls_stream) => {
            rdp_debug(
                "ironrdp.tls.ok",
                &json!({
                    "sessionId": session_id,
                    "host": host,
                    "port": port,
                    "backend": TlsBackend::NativeTls.label(),
                }),
            );
            Ok(RdpTlsStream::NativeTls(tls_stream))
        }
        Err(error) => {
            rdp_debug(
                "ironrdp.tls.error",
                &json!({
                    "sessionId": session_id,
                    "host": host,
                    "port": port,
                    "backend": TlsBackend::NativeTls.label(),
                    "error": error_chain(&error),
                }),
            );
            Err(format!("TLS handshake failed: {}", error_chain(&error)))
        }
    }
}

async fn tls_upgrade_rustls(
    stream: TcpStream,
    session_id: &str,
    host: &str,
    port: u16,
    server_name: &str,
) -> Result<RdpTlsStream, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let cipher_suites: Vec<String> = provider
        .cipher_suites
        .iter()
        .map(|suite| format!("{:?}", suite.suite()))
        .collect();
    rdp_debug(
        "ironrdp.tls.start",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
            "serverName": server_name,
            "backend": TlsBackend::Rustls.label(),
            "protocolVersions": ["TLS1.2", "TLS1.3"],
            "cipherSuites": cipher_suites,
            "sessionResumption": false,
            "certificateVerification": "disabled_for_rdp",
        }),
    );

    let tls_config = rustls::ClientConfig::builder_with_provider(Arc::clone(&provider))
        .with_protocol_versions(&[&rustls::version::TLS12, &rustls::version::TLS13])
        .map_err(|e| format!("TLS config error: {e}"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertificateVerification(provider)))
        .with_no_client_auth();

    // Disable TLS session resumption — CredSSP/MS-CSSP requires it.
    let mut tls_config = tls_config;
    tls_config.resumption = rustls::client::Resumption::disabled();

    let connector = tokio_rustls::TlsConnector::from(Arc::new(tls_config));
    let dns_name = rustls::pki_types::ServerName::try_from(server_name.to_string())
        .map_err(|e| format!("invalid server name '{server_name}': {e}"))?;
    match connector.connect(dns_name, stream).await {
        Ok(tls_stream) => {
            let (_, session) = tls_stream.get_ref();
            rdp_debug(
                "ironrdp.tls.ok",
                &json!({
                    "sessionId": session_id,
                    "host": host,
                    "port": port,
                    "backend": TlsBackend::Rustls.label(),
                    "protocolVersion": session.protocol_version().map(|version| format!("{version:?}")),
                    "cipherSuite": session
                        .negotiated_cipher_suite()
                        .map(|suite| format!("{:?}", suite.suite())),
                    "peerCertificateCount": session.peer_certificates().map(|certs| certs.len()).unwrap_or(0),
                }),
            );
            Ok(RdpTlsStream::Rustls(Box::new(tls_stream)))
        }
        Err(error) => {
            rdp_debug(
                "ironrdp.tls.error",
                &json!({
                    "sessionId": session_id,
                    "host": host,
                    "port": port,
                    "backend": TlsBackend::Rustls.label(),
                    "error": error.to_string(),
                    "errorKind": tls_error_kind(&error),
                }),
            );
            Err(format!("TLS handshake failed: {error}"))
        }
    }
}

fn extract_server_public_key(
    session_id: &str,
    tls_stream: &RdpTlsStream,
) -> Result<Vec<u8>, String> {
    let (cert_der, peer_certificate_count) = match tls_stream {
        RdpTlsStream::Rustls(tls_stream) => {
            let (_, session) = tls_stream.get_ref();
            let cert_der = session
                .peer_certificates()
                .and_then(|certs| certs.first())
                .ok_or_else(|| "RDP server sent no TLS certificate".to_string())?;
            let count = session
                .peer_certificates()
                .map(|certs| certs.len())
                .unwrap_or(0);
            (cert_der.as_ref().to_vec(), count)
        }
        RdpTlsStream::NativeTls(tls_stream) => {
            let cert = tls_stream
                .get_ref()
                .peer_certificate()
                .map_err(|e| format!("failed to read server certificate: {e}"))?
                .ok_or_else(|| "RDP server sent no TLS certificate".to_string())?;
            let cert_der = cert
                .to_der()
                .map_err(|e| format!("failed to encode server certificate: {e}"))?;
            (cert_der, 1)
        }
    };

    let spki_bytes = subject_public_key_from_cert_der(&cert_der)?;

    rdp_debug(
        "ironrdp.certificate.ok",
        &json!({
            "sessionId": session_id,
            "peerCertificateCount": peer_certificate_count,
            "subjectPublicKeyBytes": spki_bytes.len(),
        }),
    );

    Ok(spki_bytes)
}

/// Parse the certificate's SubjectPublicKeyInfo for the CredSSP public-key binding.
fn subject_public_key_from_cert_der(cert_der: &[u8]) -> Result<Vec<u8>, String> {
    use x509_cert::der::Decode as _;

    let cert = x509_cert::Certificate::from_der(cert_der)
        .map_err(|e| format!("failed to parse server certificate: {e}"))?;

    Ok(cert
        .tbs_certificate()
        .subject_public_key_info()
        .subject_public_key
        .as_bytes()
        .ok_or_else(|| "server certificate subject public key is not a bitstring".to_string())?
        .to_vec())
}

// ── Connect helper ────────────────────────────────────────────────────────────

type UpgradedFramed = ironrdp_tokio::TokioFramed<RdpTlsStream>;

/// Error from a single connect attempt. The TLS-handshake case is split out
/// because it is the only failure that triggers the legacy TLS fallback:
/// earlier failures (TCP, negotiation) would fail identically on a retry, and
/// later ones (CredSSP, finalize) already went through the TLS upgrade fine.
enum ConnectAttemptError {
    TlsHandshake(String),
    Other(String),
}

impl ConnectAttemptError {
    fn into_message(self) -> String {
        match self {
            Self::TlsHandshake(message) | Self::Other(message) => message,
        }
    }
}

/// Flatten an error and its `source()` chain into one message, so a generic
/// top-level label (e.g. "CredSSP") surfaces the underlying reason
/// (e.g. an NTLM logon failure) instead of being swallowed.
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(inner) = source {
        let inner_text = inner.to_string();
        if !message.ends_with(&inner_text) {
            message.push_str(": ");
            message.push_str(&inner_text);
        }
        source = inner.source();
    }
    message
}

fn tls_error_kind(error: &std::io::Error) -> String {
    format!("{:?}", error.kind())
}

fn validate_shared_local_folders(
    values: &[String],
    legacy_value: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let values = if values.is_empty() {
        legacy_value.into_iter().collect::<Vec<_>>()
    } else {
        values.iter().map(String::as_str).collect()
    };
    let mut roots = Vec::new();
    for value in values {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        let root = std::fs::canonicalize(value)
            .map_err(|error| format!("RDP shared local folder is unavailable: {error}"))?;
        if !root.is_dir() {
            return Err("RDP shared local folder must be a directory".to_string());
        }
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    Ok(roots)
}

#[derive(Debug)]
struct ContainedNixRdpdrBackend {
    root: PathBuf,
    inner: NixRdpdrBackend,
}

impl ContainedNixRdpdrBackend {
    fn new(root: PathBuf) -> Self {
        Self {
            inner: NixRdpdrBackend::new(root.to_string_lossy().into_owned()),
            root,
        }
    }

    fn validate_request(&self, request: &ServerDriveIoRequest) -> Result<(), String> {
        match request {
            ServerDriveIoRequest::ServerCreateDriveRequest(request) => {
                validate_rdp_remote_path(&self.root, &request.path)
            }
            ServerDriveIoRequest::ServerDriveQueryDirectoryRequest(request) => {
                validate_rdp_remote_path(&self.root, &request.path)
            }
            ServerDriveIoRequest::ServerDriveSetInformationRequest(request) => {
                if let FileInformationClass::Rename(rename) = &request.set_buffer {
                    validate_rdp_remote_path(&self.root, &rename.file_name)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

impl AsAny for ContainedNixRdpdrBackend {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

impl RdpdrBackend for ContainedNixRdpdrBackend {
    fn handle_server_device_announce_response(
        &mut self,
        pdu: ServerDeviceAnnounceResponse,
    ) -> ironrdp::pdu::PduResult<()> {
        self.inner.handle_server_device_announce_response(pdu)
    }

    fn handle_scard_call(
        &mut self,
        request: DeviceControlRequest<ScardIoCtlCode>,
        call: ScardCall,
    ) -> ironrdp::pdu::PduResult<()> {
        self.inner.handle_scard_call(request, call)
    }

    fn handle_drive_io_request(
        &mut self,
        request: ServerDriveIoRequest,
    ) -> ironrdp::pdu::PduResult<Vec<ironrdp::svc::SvcMessage>> {
        if self.validate_request(&request).is_err() {
            return Err(ironrdp::pdu::pdu_other_err!(
                "RDP shared folder request escaped the selected root"
            ));
        }
        self.inner.handle_drive_io_request(request)
    }

    fn handle_user_logged_on(
        &mut self,
        rdpdr: &mut Rdpdr,
    ) -> ironrdp::pdu::PduResult<Vec<ironrdp::svc::SvcMessage>> {
        self.inner.handle_user_logged_on(rdpdr)
    }
}

#[derive(Debug)]
struct RdpSharedFolderDevice {
    device_id: u32,
    name: String,
    root: PathBuf,
}

fn rdp_shared_folder_devices(roots: &[PathBuf]) -> Vec<RdpSharedFolderDevice> {
    let mut names = HashSet::new();
    roots
        .iter()
        .enumerate()
        .map(|(index, root)| {
            let base = root
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .unwrap_or("KKTerm Share");
            let mut name = base.to_string();
            let mut suffix = 2;
            while !names.insert(name.to_lowercase()) {
                name = format!("{base} {suffix}");
                suffix += 1;
            }
            RdpSharedFolderDevice {
                device_id: u32::try_from(index + 1).expect("RDP shared-folder count fits in u32"),
                name,
                root: root.clone(),
            }
        })
        .collect()
}

#[derive(Debug)]
struct MultiRootNixRdpdrBackend {
    drives: HashMap<u32, ContainedNixRdpdrBackend>,
}

impl MultiRootNixRdpdrBackend {
    fn new(shares: &[RdpSharedFolderDevice]) -> Self {
        Self {
            drives: shares
                .iter()
                .map(|share| {
                    (
                        share.device_id,
                        ContainedNixRdpdrBackend::new(share.root.clone()),
                    )
                })
                .collect(),
        }
    }

    fn drive_mut(
        &mut self,
        device_id: u32,
    ) -> ironrdp::pdu::PduResult<&mut ContainedNixRdpdrBackend> {
        self.drives.get_mut(&device_id).ok_or_else(|| {
            ironrdp::pdu::pdu_other_err!("RDP shared-folder request used an unknown device id")
        })
    }
}

impl AsAny for MultiRootNixRdpdrBackend {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

impl RdpdrBackend for MultiRootNixRdpdrBackend {
    fn handle_server_device_announce_response(
        &mut self,
        pdu: ServerDeviceAnnounceResponse,
    ) -> ironrdp::pdu::PduResult<()> {
        self.drive_mut(pdu.device_id)?
            .handle_server_device_announce_response(pdu)
    }

    fn handle_scard_call(
        &mut self,
        request: DeviceControlRequest<ScardIoCtlCode>,
        call: ScardCall,
    ) -> ironrdp::pdu::PduResult<()> {
        self.drive_mut(request.header.device_id)?
            .handle_scard_call(request, call)
    }

    fn handle_drive_io_request(
        &mut self,
        request: ServerDriveIoRequest,
    ) -> ironrdp::pdu::PduResult<Vec<ironrdp::svc::SvcMessage>> {
        let device_id = rdp_drive_request_device_id(&request);
        self.drive_mut(device_id)?.handle_drive_io_request(request)
    }

    fn handle_user_logged_on(
        &mut self,
        rdpdr: &mut Rdpdr,
    ) -> ironrdp::pdu::PduResult<Vec<ironrdp::svc::SvcMessage>> {
        let mut messages = Vec::new();
        for backend in self.drives.values_mut() {
            messages.extend(backend.handle_user_logged_on(rdpdr)?);
        }
        Ok(messages)
    }
}

fn rdp_drive_request_device_id(request: &ServerDriveIoRequest) -> u32 {
    match request {
        ServerDriveIoRequest::ServerCreateDriveRequest(request) => {
            request.device_io_request.device_id
        }
        ServerDriveIoRequest::ServerDriveQueryInformationRequest(request) => {
            request.device_io_request.device_id
        }
        ServerDriveIoRequest::DeviceCloseRequest(request) => request.device_io_request.device_id,
        ServerDriveIoRequest::ServerDriveQueryDirectoryRequest(request) => {
            request.device_io_request.device_id
        }
        ServerDriveIoRequest::ServerDriveNotifyChangeDirectoryRequest(request) => {
            request.device_io_request.device_id
        }
        ServerDriveIoRequest::ServerDriveQueryVolumeInformationRequest(request) => {
            request.device_io_request.device_id
        }
        ServerDriveIoRequest::DeviceControlRequest(request) => request.header.device_id,
        ServerDriveIoRequest::DeviceReadRequest(request) => request.device_io_request.device_id,
        ServerDriveIoRequest::DeviceWriteRequest(request) => request.device_io_request.device_id,
        ServerDriveIoRequest::ServerDriveSetInformationRequest(request) => {
            request.device_io_request.device_id
        }
        ServerDriveIoRequest::ServerDriveLockControlRequest(request) => {
            request.device_io_request.device_id
        }
    }
}

fn validate_rdp_remote_path(root: &Path, remote_path: &str) -> Result<(), String> {
    if remote_path.contains('\0') {
        return Err("RDP shared folder path contains a null byte".to_string());
    }
    if !remote_path.is_empty() && !remote_path.starts_with('\\') && !remote_path.starts_with('/') {
        return Err("RDP shared folder path is not rooted at the announced drive".to_string());
    }
    let normalized = remote_path.replace('\\', "/");
    let relative = normalized.trim_start_matches('/');
    let mut target = root.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(value) => target.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("RDP shared folder path contains traversal".to_string());
            }
        }
    }

    let mut existing = target.as_path();
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or_else(|| "RDP shared folder path has no valid parent".to_string())?;
    }
    let canonical = std::fs::canonicalize(existing)
        .map_err(|error| format!("failed to validate RDP shared folder path: {error}"))?;
    if !canonical.starts_with(root) {
        return Err("RDP shared folder path resolves outside the selected root".to_string());
    }
    Ok(())
}

async fn rdp_connect<R: tauri::Runtime>(
    app: AppHandle<R>,
    session_id: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    width: u16,
    height: u16,
    administrative_session: bool,
    shared_local_folders: Vec<PathBuf>,
) -> Result<(ironrdp::connector::ConnectionResult, UpgradedFramed), String> {
    // CredSSP/NTLM needs the domain separated from the username. Split a
    // `DOMAIN\user` login into (domain, user); otherwise keep the requested
    // domain and the username as-is (UPN `user@domain` is left intact).
    let (username, domain) = match username.split_once('\\') {
        Some((d, u)) if !d.trim().is_empty() && !u.trim().is_empty() => {
            (u.trim().to_string(), Some(d.trim().to_string()))
        }
        _ => (username, domain),
    };

    match rdp_connect_attempt(
        app.clone(),
        &session_id,
        &host,
        port,
        &username,
        &password,
        domain.as_deref(),
        width,
        height,
        administrative_session,
        &shared_local_folders,
        TlsBackend::Rustls,
    )
    .await
    {
        Ok(connected) => Ok(connected),
        Err(ConnectAttemptError::TlsHandshake(rustls_error)) => {
            // The TCP connection is dead after a failed handshake (old
            // Schannel typically sends RST), so the fallback restarts the
            // whole sequence — TCP connect and X.224 negotiation included.
            rdp_debug(
                "ironrdp.tls.fallback",
                &json!({
                    "sessionId": session_id,
                    "host": host,
                    "port": port,
                    "from": TlsBackend::Rustls.label(),
                    "to": TlsBackend::NativeTls.label(),
                    "reason": rustls_error,
                }),
            );
            rdp_connect_attempt(
                app,
                &session_id,
                &host,
                port,
                &username,
                &password,
                domain.as_deref(),
                width,
                height,
                administrative_session,
                &shared_local_folders,
                TlsBackend::NativeTls,
            )
            .await
            .map_err(|fallback_error| {
                format!(
                    "{rustls_error}; legacy TLS fallback failed: {}",
                    fallback_error.into_message()
                )
            })
        }
        Err(error) => Err(error.into_message()),
    }
}

#[allow(clippy::too_many_arguments)]
async fn rdp_connect_attempt<R: tauri::Runtime>(
    app: AppHandle<R>,
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    domain: Option<&str>,
    width: u16,
    height: u16,
    administrative_session: bool,
    shared_local_folders: &[PathBuf],
    backend: TlsBackend,
) -> Result<(ironrdp::connector::ConnectionResult, UpgradedFramed), ConnectAttemptError> {
    use ironrdp::connector::{
        ClientConnector, Config, Credentials, DesktopSize, ServerName, credssp::KerberosConfig,
    };
    use ironrdp::pdu::gcc::KeyboardType;
    use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
    use ironrdp_tokio::{TokioFramed, connect_begin, connect_finalize, mark_as_upgraded};

    // Step 1: TCP connect + create framed
    rdp_debug(
        "ironrdp.tcp.start",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
        }),
    );
    let stream = match TcpStream::connect((host, port)).await {
        Ok(stream) => stream,
        Err(error) => {
            rdp_debug(
                "ironrdp.tcp.error",
                &json!({
                    "sessionId": session_id,
                    "host": host,
                    "port": port,
                    "error": error.to_string(),
                    "errorKind": format!("{:?}", error.kind()),
                }),
            );
            return Err(ConnectAttemptError::Other(format!(
                "TCP connect to {host}:{port} failed: {error}"
            )));
        }
    };
    let client_addr = stream
        .local_addr()
        .map_err(|e| ConnectAttemptError::Other(e.to_string()))?;
    let peer_addr = stream.peer_addr().ok();
    rdp_debug(
        "ironrdp.tcp.ok",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
            "clientAddr": client_addr.to_string(),
            "peerAddr": peer_addr.map(|addr| addr.to_string()),
        }),
    );
    let mut framed: TokioFramed<TcpStream> = TokioFramed::new(stream);

    // Step 2: Build connector config
    let config = Config {
        credentials: Credentials::UsernamePassword {
            username: username.to_string(),
            password: password.to_string(),
        },
        domain: domain.map(str::to_string),
        administrative_session,
        enable_tls: false,
        enable_credssp: true,
        desktop_size: DesktopSize { width, height },
        desktop_scale_factor: 0,
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_functional_keys_count: 12,
        keyboard_layout: 0x0409, // en-US
        ime_file_name: String::new(),
        enable_server_pointer: true,
        pointer_software_rendering: false,
        client_build: 0,
        client_name: "KKTerm".to_string(),
        client_dir: String::new(),
        platform: MajorPlatformType::UNIX,
        hardware_id: None,
        bitmap: None,
        compression_type: None,
        performance_flags: ironrdp::pdu::rdp::client_info::PerformanceFlags::default(),
        autologon: false,
        enable_audio_playback: false,
        timezone_info: ironrdp::pdu::rdp::client_info::TimezoneInfo::default(),
        license_cache: None,
        multitransport_flags: None,
        alternate_shell: String::new(),
        work_dir: String::new(),
        dig_product_id: String::new(),
        request_data: None,
    };

    // Step 3: Create connector + begin
    rdp_debug(
        "ironrdp.connect_begin.start",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
            "clientAddr": client_addr.to_string(),
            "username": match &config.credentials {
                Credentials::UsernamePassword { username, .. } => username.as_str(),
                Credentials::SmartCard { .. } => "smart_card",
            },
            "domain": config.domain.as_deref(),
            "desktopWidth": width,
            "desktopHeight": height,
            "security": {
                "enableCredSsp": config.enable_credssp,
                "enableTls": config.enable_tls,
                "requestedProtocols": ["HYBRID", "HYBRID_EX"],
                "legacyTlsFallbackAllowed": true,
                "tlsBackend": backend.label(),
            },
        }),
    );
    let mut connector = ClientConnector::new(config, client_addr);
    connector.attach_static_channel(CliprdrClient::new(Box::new(CanvasCliprdrBackend::new(
        app.clone(),
        session_id.to_string(),
    ))));
    if !shared_local_folders.is_empty() {
        let shares = rdp_shared_folder_devices(shared_local_folders);
        // RDPDR must be advertised together with RDPSND for Windows servers
        // to send device-redirection traffic back to the client.
        connector.attach_static_channel(Rdpsnd::new(Box::new(NoopRdpsndBackend)));
        connector.attach_static_channel(
            Rdpdr::new(
                Box::new(MultiRootNixRdpdrBackend::new(&shares)),
                "KKTerm".to_string(),
            )
            .with_drives(Some(
                shares
                    .iter()
                    .map(|share| (share.device_id, share.name.clone()))
                    .collect(),
            )),
        );
    }
    let should_upgrade = match connect_begin(&mut framed, &mut connector).await {
        Ok(should_upgrade) => should_upgrade,
        Err(error) => {
            let error = error_chain(&error);
            rdp_debug(
                "ironrdp.connect_begin.error",
                &json!({
                    "sessionId": session_id,
                    "host": host,
                    "port": port,
                    "error": error,
                }),
            );
            return Err(ConnectAttemptError::Other(format!(
                "RDP connect_begin failed: {error}"
            )));
        }
    };
    rdp_debug(
        "ironrdp.connect_begin.ok",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
        }),
    );

    // Step 4: Extract inner stream
    let (tcp_stream, leftover) = framed.into_inner();
    rdp_debug(
        "ironrdp.security_upgrade.ready",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
            "leftoverBytes": leftover.len(),
        }),
    );

    // Step 5: TLS upgrade
    let tls_stream = tls_upgrade(tcp_stream, session_id, host, port, host, backend)
        .await
        .map_err(ConnectAttemptError::TlsHandshake)?;

    // Step 6: Extract server public key
    let server_public_key =
        extract_server_public_key(session_id, &tls_stream).map_err(ConnectAttemptError::Other)?;

    // Step 7: Mark as upgraded
    let upgraded = mark_as_upgraded(should_upgrade, &mut connector);

    // Step 8: Create upgraded framed over the concrete TLS stream
    let mut upgraded_framed: UpgradedFramed = TokioFramed::new_with_leftover(tls_stream, leftover);

    // Step 9: Finalize
    rdp_debug(
        "ironrdp.connect_finalize.start",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
        }),
    );
    let connection_result = match connect_finalize::<_, NoopNetworkClient>(
        upgraded,
        connector,
        &mut upgraded_framed,
        &mut NoopNetworkClient,
        ServerName::new(host),
        server_public_key,
        None::<KerberosConfig>,
    )
    .await
    {
        Ok(connection_result) => connection_result,
        Err(error) => {
            let error = error_chain(&error);
            rdp_debug(
                "ironrdp.connect_finalize.error",
                &json!({
                    "sessionId": session_id,
                    "host": host,
                    "port": port,
                    "error": error,
                }),
            );
            return Err(ConnectAttemptError::Other(format!(
                "RDP connect_finalize failed: {error}"
            )));
        }
    };
    rdp_debug(
        "ironrdp.connect_finalize.ok",
        &json!({
            "sessionId": session_id,
            "host": host,
            "port": port,
            "desktopWidth": connection_result.desktop_size.width,
            "desktopHeight": connection_result.desktop_size.height,
        }),
    );

    Ok((connection_result, upgraded_framed))
}

// ── Event loop ────────────────────────────────────────────────────────────────

#[derive(Debug)]
struct CanvasCliprdrBackend<R: tauri::Runtime> {
    app: AppHandle<R>,
    session_id: String,
    remote_formats: Vec<ClipboardFormat>,
    local_text: Option<String>,
    pending_local_format_response: Option<OwnedFormatDataResponse>,
    pending_remote_text_request: bool,
    paste_after_format_list: bool,
    pending_remote_paste_chord: bool,
}

impl<R: tauri::Runtime> CanvasCliprdrBackend<R> {
    fn new(app: AppHandle<R>, session_id: String) -> Self {
        Self {
            app,
            session_id,
            remote_formats: Vec::new(),
            local_text: None,
            pending_local_format_response: None,
            pending_remote_text_request: false,
            paste_after_format_list: false,
            pending_remote_paste_chord: false,
        }
    }
}

impl<R: tauri::Runtime> AsAny for CanvasCliprdrBackend<R> {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}

impl<R: tauri::Runtime> CliprdrBackend for CanvasCliprdrBackend<R> {
    fn temporary_directory(&self) -> &str {
        ""
    }

    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::empty()
    }

    fn on_ready(&mut self) {
        rdp_debug(
            "ironrdp.clipboard.ready",
            &json!({ "sessionId": self.session_id }),
        );
    }

    fn on_request_format_list(&mut self) {}

    fn on_format_list_response(&mut self, ok: bool) {
        if self.paste_after_format_list {
            self.pending_remote_paste_chord = ok;
            self.paste_after_format_list = false;
        }
        rdp_debug(
            "ironrdp.clipboard.format_list_response",
            &json!({
                "sessionId": self.session_id,
                "accepted": ok,
            }),
        );
    }

    fn on_process_negotiated_capabilities(
        &mut self,
        _capabilities: ClipboardGeneralCapabilityFlags,
    ) {
    }

    fn on_remote_copy(&mut self, available_formats: &[ClipboardFormat]) {
        self.remote_formats = available_formats.to_vec();
        if self
            .remote_formats
            .iter()
            .any(|format| format.id == ClipboardFormatId::CF_UNICODETEXT)
        {
            self.pending_remote_text_request = true;
        }
    }

    fn on_format_data_request(&mut self, request: FormatDataRequest) {
        rdp_debug(
            "ironrdp.clipboard.format_data_request",
            &json!({
                "sessionId": self.session_id,
                "formatId": request.format.0,
                "hasLocalText": self.local_text.is_some(),
                "characterCount": self.local_text.as_deref().map(|text| text.chars().count()),
            }),
        );
        self.pending_local_format_response =
            Some(if request.format == ClipboardFormatId::CF_UNICODETEXT {
                utf16_clipboard_response(self.local_text.as_deref().unwrap_or(""))
            } else {
                FormatDataResponse::new_error().into_owned()
            });
    }

    fn on_format_data_response(&mut self, response: FormatDataResponse<'_>) {
        if response.is_error() {
            return;
        }
        if let Some(text) = decode_utf16_clipboard_text(response.data()) {
            emit_rdp_event(
                &self.app,
                RdpCanvasEvent::ClipboardText {
                    session_id: self.session_id.clone(),
                    text,
                },
            );
        }
    }

    fn on_file_contents_request(&mut self, _request: FileContentsRequest) {}
    fn on_file_contents_response(&mut self, _response: FileContentsResponse<'_>) {}
    fn on_lock(&mut self, _data_id: LockDataId) {}
    fn on_unlock(&mut self, _data_id: LockDataId) {}
}

fn utf16_clipboard_response(text: &str) -> OwnedFormatDataResponse {
    let mut data = Vec::with_capacity((text.len() + 1) * 2);
    for code_unit in text.encode_utf16() {
        data.extend_from_slice(&code_unit.to_le_bytes());
    }
    data.extend_from_slice(&0u16.to_le_bytes());
    FormatDataResponse::new_data(data).into_owned()
}

fn decode_utf16_clipboard_text(data: &[u8]) -> Option<String> {
    let mut units = Vec::with_capacity(data.len() / 2);
    for chunk in data.chunks_exact(2) {
        let unit = u16::from_le_bytes([chunk[0], chunk[1]]);
        if unit == 0 {
            break;
        }
        units.push(unit);
    }
    String::from_utf16(&units).ok()
}

fn spawn_rdp_event_loop(
    runtime: &Runtime,
    app: AppHandle,
    session_id: String,
    connection_result: ironrdp::connector::ConnectionResult,
    mut framed: UpgradedFramed,
    mut input_rx: mpsc::UnboundedReceiver<RdpInput>,
    mut stop: oneshot::Receiver<()>,
) {
    runtime.spawn(async move {
        eprintln!("[rdp {session_id}] event loop starting");
        rdp_debug(
            "ironrdp.event_loop.start",
            &json!({
                "sessionId": session_id,
            }),
        );

        let width = connection_result.desktop_size.width;
        let height = connection_result.desktop_size.height;

        emit_rdp_event(
            &app,
            RdpCanvasEvent::Connected {
                session_id: session_id.clone(),
                name: "RDP".to_string(),
            },
        );
        emit_rdp_event(
            &app,
            RdpCanvasEvent::Resolution { session_id: session_id.clone(), width, height },
        );

        let mut image = ironrdp::session::image::DecodedImage::new(
            ironrdp::graphics::image_processing::PixelFormat::RgbA32,
            width,
            height,
        );
        let mut active_stage = ironrdp::session::ActiveStage::new(connection_result);
        let mut input_db = ironrdp::input::Database::new();
        let mut last_button_mask: u8 = 0;

        loop {
            tokio::select! {
                _ = &mut stop => {
                    eprintln!("[rdp {session_id}] stop signal received");
                    break;
                }
                input = input_rx.recv() => {
                    match input {
                        Some(RdpInput::ResendFullFrame) => {
                            // Replay the whole decoded framebuffer so a freshly
                            // attached surface (detached full-screen window) paints
                            // immediately instead of waiting for server deltas.
                            emit_rdp_event(
                                &app,
                                RdpCanvasEvent::Resolution {
                                    session_id: session_id.clone(),
                                    width,
                                    height,
                                },
                            );
                            emit_rdp_event(&app, RdpCanvasEvent::RawImage {
                                session_id: session_id.clone(),
                                x: 0,
                                y: 0,
                                width,
                                height,
                                rgba: BASE64.encode(image.data()),
                            });
                        }
                        Some(rdp_input) => {
                            if let Err(e) = send_rdp_input(
                                &session_id,
                                &mut framed,
                                &mut active_stage,
                                &mut input_db,
                                &mut last_button_mask,
                                rdp_input,
                            ).await {
                                eprintln!("[rdp {session_id}] send_rdp_input error: {e}");
                                rdp_debug(
                                    "ironrdp.input.error",
                                    &json!({
                                        "sessionId": session_id,
                                        "error": e,
                                    }),
                                );
                                emit_rdp_event(&app, RdpCanvasEvent::Error {
                                    session_id: session_id.clone(),
                                    message: e,
                                });
                                break;
                            }
                        }
                        None => break,
                    }
                }
                pdu = framed.read_pdu() => {
                    match pdu {
                        Ok((action, payload)) => {
                            let outputs = match active_stage.process(&mut image, action, &payload) {
                                Ok(outputs) => outputs,
                                Err(e) => {
                                    eprintln!("[rdp {session_id}] active_stage.process error: {e}");
                                    rdp_debug(
                                        "ironrdp.active_stage.error",
                                        &json!({
                                            "sessionId": session_id,
                                            "error": e.to_string(),
                                        }),
                                    );
                                    emit_rdp_event(&app, RdpCanvasEvent::Error {
                                        session_id: session_id.clone(),
                                        message: e.to_string(),
                                    });
                                    break;
                                }
                            };

                            let mut should_break = false;
                            for output in outputs {
                                use ironrdp::session::ActiveStageOutput;
                                match output {
                                    ActiveStageOutput::ResponseFrame(frame) => {
                                        if let Err(e) = write_rdp_frame(&mut framed, &frame).await {
                                            eprintln!("[rdp {session_id}] write_all error: {e}");
                                            rdp_debug(
                                                "ironrdp.write.error",
                                                &json!({
                                                    "sessionId": session_id,
                                                    "error": e.to_string(),
                                                }),
                                            );
                                            emit_rdp_event(&app, RdpCanvasEvent::Error {
                                                session_id: session_id.clone(),
                                                message: e.to_string(),
                                            });
                                            should_break = true;
                                            break;
                                        }
                                    }
                                    ActiveStageOutput::GraphicsUpdate(region) => {
                                        let rx = u16::try_from(region.left).unwrap_or(0);
                                        let ry = u16::try_from(region.top).unwrap_or(0);
                                        let rw = u16::try_from(
                                            region.right.saturating_sub(region.left).saturating_add(1)
                                        ).unwrap_or(0);
                                        let rh = u16::try_from(
                                            region.bottom.saturating_sub(region.top).saturating_add(1)
                                        ).unwrap_or(0);
                                        let image_data = image.data();
                                        let rect_rgba = extract_rgba_rect(image_data, width, rx, ry, rw, rh);
                                        emit_rdp_event(&app, RdpCanvasEvent::RawImage {
                                            session_id: session_id.clone(),
                                            x: rx,
                                            y: ry,
                                            width: rw,
                                            height: rh,
                                            rgba: BASE64.encode(rect_rgba),
                                        });
                                    }
                                    ActiveStageOutput::PointerBitmap(pointer) => {
                                        let event = cursor_event(&session_id, &pointer);
                                        emit_rdp_event(&app, event);
                                    }
                                    ActiveStageOutput::Terminate(_reason) => {
                                        eprintln!("[rdp {session_id}] server initiated disconnect");
                                        rdp_debug(
                                            "ironrdp.server_disconnect",
                                            &json!({
                                                "sessionId": session_id,
                                            }),
                                        );
                                        should_break = true;
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                            if should_break {
                                break;
                            }
                            if let Err(e) = flush_pending_clipboard_response(&session_id, &mut framed, &mut active_stage).await {
                                eprintln!("[rdp {session_id}] clipboard response error: {e}");
                            }
                            if let Err(e) = flush_pending_remote_paste_chord(
                                &session_id,
                                &mut framed,
                                &mut active_stage,
                                &mut input_db,
                            ).await {
                                eprintln!("[rdp {session_id}] remote paste chord error: {e}");
                            }
                            if let Err(e) = flush_pending_clipboard_request(&mut framed, &mut active_stage).await {
                                eprintln!("[rdp {session_id}] clipboard request error: {e}");
                            }
                        }
                        Err(e) => {
                            eprintln!("[rdp {session_id}] read_pdu error: {e}");
                            rdp_debug(
                                "ironrdp.read.error",
                                &json!({
                                    "sessionId": session_id,
                                    "error": e.to_string(),
                                }),
                            );
                            emit_rdp_event(&app, RdpCanvasEvent::Error {
                                session_id: session_id.clone(),
                                message: e.to_string(),
                            });
                            break;
                        }
                    }
                }
            }
        }

        eprintln!("[rdp {session_id}] event loop exiting");
        rdp_debug(
            "ironrdp.event_loop.exit",
            &json!({
                "sessionId": session_id,
            }),
        );
        emit_rdp_event(&app, RdpCanvasEvent::Disconnected { session_id });
    });
}

// ── Input stub (Task 5 fills in real IronRDP input encoding) ──────────────────

/// Detect press/release transitions for the three primary mouse buttons between
/// a previous and current VNC-style button mask (bit 0 = left, 1 = middle,
/// 2 = right). Returns `(button_bit, pressed)` for each changed button.
fn primary_button_transitions(prev: u8, now: u8) -> Vec<(u8, bool)> {
    let mut out = Vec::new();
    for bit in 0..3u8 {
        let was = prev & (1 << bit) != 0;
        let is = now & (1 << bit) != 0;
        if is != was {
            out.push((bit, is));
        }
    }
    out
}

fn mouse_button_for_bit(bit: u8) -> ironrdp::input::MouseButton {
    use ironrdp::input::MouseButton;
    match bit {
        0 => MouseButton::Left,
        1 => MouseButton::Middle,
        _ => MouseButton::Right,
    }
}

/// Translate a queued `RdpInput` into IronRDP input operations, apply them to the
/// keyboard/mouse state `db`, encode the resulting FastPath events, and write the
/// PDU to the server. `last_button_mask` carries the previous primary-button mask
/// so press/release can be derived from the absolute mask the frontend sends.
async fn send_rdp_input(
    session_id: &str,
    framed: &mut UpgradedFramed,
    active_stage: &mut ironrdp::session::ActiveStage,
    db: &mut ironrdp::input::Database,
    last_button_mask: &mut u8,
    input: RdpInput,
) -> Result<(), String> {
    use ironrdp::input::{MousePosition, Operation, Scancode, WheelRotations};
    let mut ops: Vec<Operation> = Vec::new();
    match input {
        RdpInput::Pointer { x, y, button_mask } => {
            ops.push(Operation::MouseMove(MousePosition { x, y }));
            for (bit, pressed) in primary_button_transitions(*last_button_mask, button_mask) {
                let button = mouse_button_for_bit(bit);
                ops.push(if pressed {
                    Operation::MouseButtonPressed(button)
                } else {
                    Operation::MouseButtonReleased(button)
                });
            }
            // RFB-style wheel bits (3 = up, 4 = down) are momentary notches.
            if button_mask & (1 << 3) != 0 {
                ops.push(Operation::WheelRotations(WheelRotations {
                    is_vertical: true,
                    rotation_units: 120,
                }));
            }
            if button_mask & (1 << 4) != 0 {
                ops.push(Operation::WheelRotations(WheelRotations {
                    is_vertical: true,
                    rotation_units: -120,
                }));
            }
            // Remember only the three primary buttons; wheel bits are momentary.
            *last_button_mask = button_mask & 0b0000_0111;
        }
        RdpInput::Key { scancode, down } => {
            let sc = Scancode::from(scancode);
            ops.push(if down {
                Operation::KeyPressed(sc)
            } else {
                Operation::KeyReleased(sc)
            });
        }
        RdpInput::Text(text) => {
            // Each character is sent as a Unicode keyboard event (press + release),
            // so IME-composed and layout-specific characters reach the server
            // correctly regardless of the remote keyboard layout.
            for character in text.chars() {
                ops.push(Operation::UnicodeKeyPressed(character));
                ops.push(Operation::UnicodeKeyReleased(character));
            }
        }
        RdpInput::LocalClipboardText(text) => {
            advertise_local_clipboard_text(session_id, framed, active_stage, text, false).await?;
            return Ok(());
        }
        RdpInput::PasteLocalClipboardText(text) => {
            advertise_local_clipboard_text(session_id, framed, active_stage, text, true).await?;
            return Ok(());
        }
        RdpInput::CtrlAltDelete => {
            let ctrl = Scancode::from_u16(0x001D);
            let alt = Scancode::from_u16(0x0038);
            let delete = Scancode::from_u16(0xE053);
            ops.extend([
                Operation::KeyPressed(ctrl),
                Operation::KeyPressed(alt),
                Operation::KeyPressed(delete),
                Operation::KeyReleased(delete),
                Operation::KeyReleased(alt),
                Operation::KeyReleased(ctrl),
            ]);
        }
    }

    let events = db.apply(ops);
    if events.is_empty() {
        return Ok(());
    }

    let pdu = ironrdp::pdu::input::fast_path::FastPathInput::new(events.to_vec())
        .map_err(|e| format!("failed to build RDP input PDU: {e}"))?;
    let bytes =
        ironrdp::core::encode_vec(&pdu).map_err(|e| format!("failed to encode RDP input: {e}"))?;
    write_rdp_frame(framed, &bytes).await?;
    Ok(())
}

async fn advertise_local_clipboard_text(
    session_id: &str,
    framed: &mut UpgradedFramed,
    active_stage: &mut ironrdp::session::ActiveStage,
    text: String,
    paste_after_format_list: bool,
) -> Result<(), String> {
    let character_count = text.chars().count();
    let cliprdr = active_stage
        .get_svc_processor_mut::<CliprdrClient>()
        .ok_or_else(|| "RDP clipboard channel is not available".to_string())?;
    if let Some(backend) = cliprdr.downcast_backend_mut::<CanvasCliprdrBackend<tauri::Wry>>() {
        backend.local_text = Some(text);
        backend.paste_after_format_list = paste_after_format_list;
        backend.pending_remote_paste_chord = false;
    }
    let messages = cliprdr
        .initiate_copy(&[ClipboardFormat::new(ClipboardFormatId::CF_UNICODETEXT)])
        .map_err(|e| format!("failed to advertise local clipboard to RDP: {e}"))?;
    let bytes = active_stage
        .process_svc_processor_messages::<CliprdrClient>(messages)
        .map_err(|e| format!("failed to encode RDP clipboard update: {e}"))?;
    write_rdp_frame(framed, &bytes).await?;
    rdp_debug(
        "ironrdp.clipboard.format_list_sent",
        &json!({
            "sessionId": session_id,
            "characterCount": character_count,
        }),
    );
    Ok(())
}

async fn flush_pending_remote_paste_chord(
    session_id: &str,
    framed: &mut UpgradedFramed,
    active_stage: &mut ironrdp::session::ActiveStage,
    db: &mut ironrdp::input::Database,
) -> Result<(), String> {
    use ironrdp::input::{Operation, Scancode};

    let should_paste = active_stage
        .get_svc_processor_mut::<CliprdrClient>()
        .and_then(|cliprdr| cliprdr.downcast_backend_mut::<CanvasCliprdrBackend<tauri::Wry>>())
        .map(|backend| std::mem::take(&mut backend.pending_remote_paste_chord))
        .unwrap_or(false);
    if !should_paste {
        return Ok(());
    }
    let ctrl = Scancode::from_u16(0x001D);
    let v = Scancode::from_u16(0x002F);
    let events = db.apply([
        Operation::KeyPressed(ctrl),
        Operation::KeyPressed(v),
        Operation::KeyReleased(v),
        Operation::KeyReleased(ctrl),
    ]);
    let pdu = ironrdp::pdu::input::fast_path::FastPathInput::new(events.to_vec())
        .map_err(|e| format!("failed to build remote paste input PDU: {e}"))?;
    let bytes = ironrdp::core::encode_vec(&pdu)
        .map_err(|e| format!("failed to encode remote paste input: {e}"))?;
    write_rdp_frame(framed, &bytes).await?;
    rdp_debug(
        "ironrdp.clipboard.remote_paste_sent",
        &json!({ "sessionId": session_id }),
    );
    Ok(())
}

async fn write_rdp_frame(framed: &mut UpgradedFramed, bytes: &[u8]) -> Result<(), String> {
    use ironrdp_tokio::FramedWrite as _;

    framed
        .write_all(bytes)
        .await
        .map_err(|e| format!("failed to send RDP frame: {e}"))
}

async fn flush_pending_clipboard_request(
    framed: &mut UpgradedFramed,
    active_stage: &mut ironrdp::session::ActiveStage,
) -> Result<(), String> {
    let cliprdr = match active_stage.get_svc_processor_mut::<CliprdrClient>() {
        Some(cliprdr) => cliprdr,
        None => return Ok(()),
    };
    let should_request = cliprdr
        .downcast_backend_mut::<CanvasCliprdrBackend<tauri::Wry>>()
        .map(|backend| {
            let pending = backend.pending_remote_text_request;
            backend.pending_remote_text_request = false;
            pending
        })
        .unwrap_or(false);
    if !should_request {
        return Ok(());
    }
    let messages = cliprdr
        .initiate_paste(ClipboardFormatId::CF_UNICODETEXT)
        .map_err(|e| format!("failed to request remote clipboard text: {e}"))?;
    let bytes = active_stage
        .process_svc_processor_messages::<CliprdrClient>(messages)
        .map_err(|e| format!("failed to encode RDP clipboard request: {e}"))?;
    write_rdp_frame(framed, &bytes).await
}

async fn flush_pending_clipboard_response(
    session_id: &str,
    framed: &mut UpgradedFramed,
    active_stage: &mut ironrdp::session::ActiveStage,
) -> Result<(), String> {
    let cliprdr = match active_stage.get_svc_processor_mut::<CliprdrClient>() {
        Some(cliprdr) => cliprdr,
        None => return Ok(()),
    };
    let response = cliprdr
        .downcast_backend_mut::<CanvasCliprdrBackend<tauri::Wry>>()
        .and_then(|backend| backend.pending_local_format_response.take());
    let Some(response) = response else {
        return Ok(());
    };
    let response_bytes = response.data().len();
    let messages = cliprdr
        .submit_format_data(response)
        .map_err(|e| format!("failed to submit local clipboard data to RDP: {e}"))?;
    let bytes = active_stage
        .process_svc_processor_messages::<CliprdrClient>(messages)
        .map_err(|e| format!("failed to encode RDP clipboard response: {e}"))?;
    write_rdp_frame(framed, &bytes).await?;
    rdp_debug(
        "ironrdp.clipboard.format_data_response_sent",
        &json!({
            "sessionId": session_id,
            "responseBytes": response_bytes,
        }),
    );
    Ok(())
}

#[cfg(target_os = "macos")]
fn read_system_clipboard_text() -> Result<String, String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};

    // SAFETY: NSPasteboardTypeString is an AppKit-provided process-lifetime
    // NSString constant.
    let string_type = unsafe { NSPasteboardTypeString };
    NSPasteboard::generalPasteboard()
        .stringForType(string_type)
        .map(|text| text.to_string())
        .ok_or_else(|| "macOS clipboard does not contain plain text".to_string())
}

#[cfg(not(target_os = "macos"))]
fn read_system_clipboard_text() -> Result<String, String> {
    Err("native RDP clipboard paste is only available on macOS".to_string())
}

// ── Cursor stub (Task 5 fills in real pointer decoding) ───────────────────────

fn cursor_event(
    session_id: &str,
    pointer: &ironrdp::graphics::pointer::DecodedPointer,
) -> RdpCanvasEvent {
    // Task 5 may refine the pixel format; `bitmap_data` is the decoded pointer
    // bitmap and `hotspot_x/y` the click hotspot.
    RdpCanvasEvent::SetCursor {
        session_id: session_id.to_string(),
        width: pointer.width,
        height: pointer.height,
        hot_x: pointer.hotspot_x,
        hot_y: pointer.hotspot_y,
        rgba: BASE64.encode(&pointer.bitmap_data),
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

fn emit_rdp_event<R: tauri::Runtime>(app: &AppHandle<R>, event: RdpCanvasEvent) {
    let _ = app.emit("rdp-canvas-event", event);
}

fn required_id(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("RDP session id is required".to_string());
    }
    if trimmed.len() > 96 {
        return Err("RDP session id must be 96 characters or fewer".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("RDP session id may only contain letters, digits, '-' or '_'".to_string());
    }
    Ok(trimmed.to_string())
}

/// Copy the `(x, y, w, h)` sub-rectangle out of a full-frame RGBA buffer
/// (`stride = full_width * 4`) into a tightly packed RGBA buffer.
fn extract_rgba_rect(full_rgba: &[u8], full_width: u16, x: u16, y: u16, w: u16, h: u16) -> Vec<u8> {
    let stride = full_width as usize * 4;
    let mut out = Vec::with_capacity(w as usize * h as usize * 4);
    for row in 0..h as usize {
        let src_y = y as usize + row;
        let start = src_y * stride + x as usize * 4;
        let end = start + w as usize * 4;
        if end <= full_rgba.len() {
            out.extend_from_slice(&full_rgba[start..end]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

    /// TPKT + X.224 Connection Confirm with an RDP_NEG_RSP selecting HYBRID
    /// (NLA) — the negotiation response a Windows host sends right before the
    /// client starts the TLS upgrade.
    const X224_CONNECTION_CONFIRM_HYBRID: [u8; 19] = [
        0x03, 0x00, 0x00, 0x13, // TPKT header, total length 19
        0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00, // X.224 Connection Confirm
        0x02, 0x00, 0x08, 0x00, 0x02, 0x00, 0x00, 0x00, // RDP_NEG_RSP: PROTOCOL_HYBRID
    ];

    /// Regression test for issue #344: a host that accepts RDP negotiation but
    /// kills the connection during the TLS handshake (old Schannel with no
    /// cipher overlap against rustls) must trigger the legacy native-tls
    /// fallback, i.e. a full second connection attempt from TCP connect on.
    #[tokio::test]
    async fn tls_handshake_failure_triggers_legacy_native_tls_fallback() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = tokio::spawn(async move {
            let mut connections = 0u32;
            for _ in 0..2 {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                connections += 1;
                let mut buf = [0u8; 512];
                // Read the X.224 Connection Request, confirm HYBRID, then
                // drop the socket as soon as the TLS ClientHello arrives.
                let _ = socket.read(&mut buf).await;
                let _ = socket.write_all(&X224_CONNECTION_CONFIRM_HYBRID).await;
                let _ = socket.read(&mut buf).await;
            }
            connections
        });

        let app = tauri::test::mock_app();
        let error = match rdp_connect(
            app.handle().clone(),
            "rdp-test".to_string(),
            "127.0.0.1".to_string(),
            port,
            "user".to_string(),
            "password".to_string(),
            None,
            1280,
            800,
            false,
            Vec::new(),
        )
        .await
        {
            Ok(_) => panic!("connect must fail against the handshake-killing server"),
            Err(error) => error,
        };

        let connections = server.await.unwrap();
        assert_eq!(
            connections, 2,
            "expected a second (native-tls fallback) connection attempt"
        );
        assert!(
            error.contains("legacy TLS fallback failed"),
            "error should surface both attempts, got: {error}"
        );
    }

    #[test]
    fn validates_session_ids() {
        assert_eq!(required_id("rdp-1".to_string()).as_deref(), Ok("rdp-1"));
        assert!(required_id("bad/session".to_string()).is_err());
    }

    #[test]
    fn rdp_client_start_debug_payload_excludes_password() {
        let payload = rdp_client_start_debug_payload(
            "rdp-1",
            "server.example.test",
            3389,
            "admin",
            Some("EXAMPLE"),
            1440,
            900,
            true,
            2,
        );

        assert_eq!(payload["sessionId"], "rdp-1");
        assert_eq!(payload["host"], "server.example.test");
        assert_eq!(payload["port"], 3389);
        assert_eq!(payload["username"], "admin");
        assert_eq!(payload["domain"], "EXAMPLE");
        assert_eq!(payload["desktopWidth"], 1440);
        assert_eq!(payload["desktopHeight"], 900);
        assert_eq!(payload["administrativeSession"], true);
        assert_eq!(payload["sharedLocalFolderCount"], 2);
        assert_eq!(payload["security"]["enableCredSsp"], true);
        assert_eq!(payload["security"]["enableTls"], false);
        assert!(payload.get("password").is_none());
    }

    #[test]
    fn start_request_deserializes_with_defaults() {
        let json = r#"{"sessionId":"rdp-1","host":"win.local","username":"u","password":"p"}"#;
        let request: StartRdpClientSessionRequest =
            serde_json::from_str(json).expect("request deserializes");
        assert_eq!(request.host, "win.local");
        assert!(request.domain.is_none());
        assert_eq!(request.desktop_width(), DEFAULT_RDP_WIDTH);
        assert_eq!(request.desktop_height(), DEFAULT_RDP_HEIGHT);
        assert!(!request.administrative_session);
        assert!(request.shared_local_folders.is_empty());
    }

    #[test]
    fn shared_folder_devices_use_distinct_ids_names_and_backends() {
        let roots = vec![
            PathBuf::from("/one/share"),
            PathBuf::from("/two/share"),
            PathBuf::from("/three/other"),
        ];
        let shares = rdp_shared_folder_devices(&roots);

        assert_eq!(
            shares
                .iter()
                .map(|share| share.device_id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(
            shares
                .iter()
                .map(|share| share.name.as_str())
                .collect::<Vec<_>>(),
            vec!["share", "share 2", "other"]
        );
        let backend = MultiRootNixRdpdrBackend::new(&shares);
        assert_eq!(backend.drives.len(), 3);
        assert!(backend.drives.contains_key(&1));
        assert!(backend.drives.contains_key(&2));
        assert!(backend.drives.contains_key(&3));
    }

    #[test]
    fn extracts_rgba_rect_from_framebuffer() {
        // 2x2 RGBA image, extract the bottom-right 1x1 pixel.
        let width = 2u16;
        let full = vec![0, 0, 0, 255, 1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255];
        let rect = extract_rgba_rect(&full, width, 1, 1, 1, 1);
        assert_eq!(rect, vec![3, 3, 3, 255]);
    }

    #[test]
    fn button_transitions_detect_press_and_release() {
        assert_eq!(primary_button_transitions(0b000, 0b001), vec![(0, true)]); // left down
        assert_eq!(primary_button_transitions(0b001, 0b000), vec![(0, false)]); // left up
        assert_eq!(primary_button_transitions(0b001, 0b001), vec![]); // held, no change
        assert_eq!(primary_button_transitions(0b000, 0b100), vec![(2, true)]); // right down
        assert_eq!(
            primary_button_transitions(0b000, 0b101),
            vec![(0, true), (2, true)] // left + right down
        );
    }
}

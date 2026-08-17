use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    net::SocketAddr,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    net::{TcpStream, lookup_host},
    runtime::Runtime,
    sync::{mpsc, oneshot, watch},
    time,
};
use vnc::{
    ClientKeyEvent, ClientMouseEvent, PixelFormat, VncConnector, VncEncoding, VncEvent, X11Event,
};

const DEFAULT_VNC_PORT: u16 = 5900;
const VNC_RESOLVE_TIMEOUT: Duration = Duration::from_secs(5);
const VNC_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const VNC_FRAME_CACHE_SIZE: usize = 4;
const VNC_FRAME_MAGIC: &[u8; 4] = b"KVF1";
const VNC_FRAME_VERSION: u16 = 1;
const TIGHT_COMPRESSION_LEVEL_BASE: i32 = -256;
const TIGHT_JPEG_QUALITY_LEVEL_BASE: i32 = -32;
const X11_CONTROL_LEFT: u32 = 0xffe3;
const X11_ALT_LEFT: u32 = 0xffe9;
const X11_DELETE: u32 = 0xffff;

pub struct VncSessionManager {
    runtime: Runtime,
    sessions: Mutex<HashMap<String, VncSession>>,
}

struct VncSession {
    client: vnc::VncClient,
    input: mpsc::UnboundedSender<VncLoopInput>,
    pointer: watch::Sender<Option<ClientMouseEvent>>,
    frames: Arc<Mutex<VncFrameCache>>,
    stop: Option<oneshot::Sender<()>>,
    connected: bool,
    view_only: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartVncSessionRequest {
    session_id: String,
    host: String,
    port: Option<u16>,
    #[serde(default)]
    username: Option<String>,
    secret_owner_id: Option<String>,
    password: Option<String>,
    options: Option<VncSessionOptions>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncSessionOptions {
    #[serde(default = "default_true")]
    shared_session: bool,
    #[serde(default)]
    view_only: bool,
    #[serde(default = "default_vnc_color_level")]
    color_level: String,
    #[serde(default = "default_vnc_preferred_encoding")]
    preferred_encoding: String,
    #[serde(default = "default_vnc_performance_preset")]
    performance_preset: String,
    #[serde(default = "default_vnc_compression_level")]
    compression_level: u8,
    #[serde(default = "default_vnc_jpeg_quality")]
    jpeg_quality: u8,
    #[serde(default = "default_true")]
    jpeg_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncSessionStarted {
    session_id: String,
    host: String,
    port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncSessionStatus {
    session_id: String,
    connected: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncPointerEventRequest {
    session_id: String,
    x: u16,
    y: u16,
    button_mask: u8,
    #[serde(default)]
    coalescible: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncKeyEventRequest {
    session_id: String,
    key: u32,
    down: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncSimpleRequest {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncFrameRequest {
    session_id: String,
    frame_id: u64,
}

#[derive(Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
enum VncSessionEvent {
    Connected {
        session_id: String,
        name: String,
    },
    Resolution {
        session_id: String,
        width: u16,
        height: u16,
    },
    FrameAvailable {
        session_id: String,
        frame_id: u64,
        width: u16,
        height: u16,
        payload_bytes: usize,
        operation_count: usize,
        wire_bytes: u64,
        decode_micros: u64,
        bridge_micros: u64,
        rectangles: u32,
        raw_rectangles: u32,
        copy_rectangles: u32,
        tight_rectangles: u32,
        zrle_rectangles: u32,
        trle_rectangles: u32,
        cursor_rectangles: u32,
        desktop_size_rectangles: u32,
    },
    Bell {
        session_id: String,
    },
    SetCursor {
        session_id: String,
        width: u16,
        height: u16,
        hot_x: u16,
        hot_y: u16,
        rgba: String,
    },
    ClipboardText {
        session_id: String,
        text: String,
    },
    Error {
        session_id: String,
        message: String,
    },
    Disconnected {
        session_id: String,
    },
}

#[derive(Clone)]
enum VncLoopInput {
    Protocol(X11Event),
    FramePainted(u64),
}

fn take_vnc_refresh_request(
    input: X11Event,
    request_in_flight: bool,
    awaiting_frame_ack: &mut Option<u64>,
) -> Option<X11Event> {
    let force_full_refresh = matches!(input, X11Event::FullRefresh);
    if force_full_refresh {
        // A detached surface may take ownership while an incremental request
        // is waiting indefinitely for damage, or after the previous surface
        // missed the last frame event. RFB permits multiple outstanding
        // requests, so the handoff refresh must bypass both waits.
        *awaiting_frame_ack = None;
        return Some(X11Event::FullRefresh);
    }

    if request_in_flight || awaiting_frame_ack.is_some() {
        return None;
    }
    Some(X11Event::Refresh)
}

#[derive(Clone, Copy)]
struct EffectiveVncPerformance {
    automatic: bool,
    preferred_encoding: &'static str,
    color_level: &'static str,
    compression_level: u8,
    jpeg_quality: u8,
    jpeg_enabled: bool,
}

enum VncFrameOperation {
    Raw { rect: vnc::Rect, rgba: Vec<u8> },
    Jpeg { rect: vnc::Rect, bytes: Vec<u8> },
    Copy { dst: vnc::Rect, src: vnc::Rect },
}

#[derive(Default)]
struct VncFrameBatch {
    operations: Vec<VncFrameOperation>,
}

struct CachedVncFrame {
    id: u64,
    bytes: Vec<u8>,
}

#[derive(Default)]
struct VncFrameCache {
    frames: VecDeque<CachedVncFrame>,
}

impl VncSessionManager {
    pub fn new() -> Self {
        Self {
            runtime: Runtime::new().expect("VNC runtime initializes"),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_session(
        &self,
        app: AppHandle,
        request: StartVncSessionRequest,
    ) -> Result<VncSessionStarted, String> {
        let session_id = required_id(request.session_id)?;
        let host = required_field("VNC host", request.host)?;
        let port = request.port.unwrap_or(DEFAULT_VNC_PORT);
        if port == 0 {
            return Err("VNC port must be between 1 and 65535".to_string());
        }

        {
            let sessions = self.lock_sessions()?;
            if sessions.contains_key(&session_id) {
                return Err(format!("VNC session '{session_id}' is already running"));
            }
        }

        let password = request.password.clone();
        let username = request
            .username
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let options = request.options.unwrap_or_default();
        validate_vnc_session_options(&options)?;
        let performance = effective_vnc_performance(&options);
        let pixel_format = pixel_format_for(performance.color_level);
        let address = self.runtime.block_on(resolve_vnc_address(&host, port))?;
        let client = self
            .runtime
            .block_on(connect_vnc(
                address,
                username,
                password,
                &options,
                performance,
                pixel_format,
            ))?;
        let (stop_tx, stop_rx) = oneshot::channel();
        let (input_tx, input_rx) = mpsc::unbounded_channel();
        let (pointer_tx, pointer_rx) = watch::channel(None);
        let frames = Arc::new(Mutex::new(VncFrameCache::default()));
        spawn_vnc_event_loop(
            &self.runtime,
            app,
            session_id.clone(),
            client.clone(),
            input_rx,
            pointer_rx,
            Arc::clone(&frames),
            pixel_format,
            stop_rx,
        );

        let mut sessions = self.lock_sessions()?;
        sessions.insert(
            session_id.clone(),
            VncSession {
                client,
                input: input_tx,
                pointer: pointer_tx,
                frames,
                stop: Some(stop_tx),
                connected: true,
                view_only: options.view_only,
            },
        );

        Ok(VncSessionStarted {
            session_id,
            host,
            port,
        })
    }

    pub fn pointer_event(&self, request: VncPointerEventRequest) -> Result<(), String> {
        let pointer = ClientMouseEvent {
            position_x: request.x,
            position_y: request.y,
            bottons: request.button_mask,
        };
        if request.coalescible {
            let sessions = self.lock_sessions()?;
            let session = sessions
                .get(&request.session_id)
                .ok_or_else(|| format!("VNC session '{}' was not found", request.session_id))?;
            if session.view_only {
                return Ok(());
            }
            session.pointer.send_replace(Some(pointer));
            Ok(())
        } else {
            self.queue_protocol_input(&request.session_id, X11Event::PointerEvent(pointer))
        }
    }

    pub fn key_event(&self, request: VncKeyEventRequest) -> Result<(), String> {
        self.queue_protocol_input(
            &request.session_id,
            X11Event::KeyEvent(ClientKeyEvent {
                keycode: request.key,
                down: request.down,
            }),
        )
    }

    pub fn send_ctrl_alt_delete(&self, request: VncSimpleRequest) -> Result<(), String> {
        let session_id = request.session_id;
        self.queue_protocol_input(&session_id, key_input(X11_CONTROL_LEFT, true))?;
        self.queue_protocol_input(&session_id, key_input(X11_ALT_LEFT, true))?;
        self.queue_protocol_input(&session_id, key_input(X11_DELETE, true))?;
        self.queue_protocol_input(&session_id, key_input(X11_DELETE, false))?;
        self.queue_protocol_input(&session_id, key_input(X11_ALT_LEFT, false))?;
        self.queue_protocol_input(&session_id, key_input(X11_CONTROL_LEFT, false))
    }

    pub fn refresh(&self, request: VncSimpleRequest) -> Result<(), String> {
        self.queue_loop_input(
            &request.session_id,
            VncLoopInput::Protocol(X11Event::FullRefresh),
        )
    }

    pub fn read_frame(&self, request: VncFrameRequest) -> Result<Vec<u8>, String> {
        let sessions = self.lock_sessions()?;
        let session = sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("VNC session '{}' was not found", request.session_id))?;
        let frames = session
            .frames
            .lock()
            .map_err(|_| "VNC frame cache lock is poisoned".to_string())?;
        frames
            .frames
            .iter()
            .find(|frame| frame.id == request.frame_id)
            .map(|frame| frame.bytes.clone())
            .ok_or_else(|| format!("VNC frame '{}' is no longer available", request.frame_id))
    }

    pub fn acknowledge_frame(&self, request: VncFrameRequest) -> Result<(), String> {
        self.queue_loop_input(&request.session_id, VncLoopInput::FramePainted(request.frame_id))
    }

    pub fn close_session(&self, request: VncSimpleRequest) -> Result<(), String> {
        // Remove under the lock, then drop the guard before the blocking
        // close() so a hung server teardown can't stall input/status for every
        // other VNC session. The explicit close is kept (not just the stop
        // signal) so the socket is actually closed before this returns.
        let removed = {
            let mut sessions = self.lock_sessions()?;
            sessions.remove(&request.session_id)
        };
        if let Some(mut session) = removed {
            if let Some(stop) = session.stop.take() {
                let _ = stop.send(());
            }
            self.runtime.block_on(async {
                let _ = session.client.close().await;
                // client.close() only signals the network/decode tasks to stop;
                // it does not wait for them to actually drop the TcpStream. A
                // reconnect to the same host right after this returns can race
                // that teardown and get refused/EOF'd by servers that only
                // accept a single connection. Give the stop signal a moment to
                // be scheduled and the socket to actually close.
                time::sleep(Duration::from_millis(250)).await;
            });
        }
        Ok(())
    }

    pub fn session_status(&self, request: VncSimpleRequest) -> Result<VncSessionStatus, String> {
        let sessions = self.lock_sessions()?;
        let connected = sessions
            .get(&request.session_id)
            .map(|session| session.connected)
            .unwrap_or(false);
        Ok(VncSessionStatus {
            session_id: request.session_id,
            connected,
        })
    }

    fn queue_protocol_input(&self, session_id: &str, event: X11Event) -> Result<(), String> {
        let sessions = self.lock_sessions()?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("VNC session '{session_id}' was not found"))?;
        if session.view_only {
            return Ok(());
        }
        session
            .input
            .send(VncLoopInput::Protocol(event))
            .map_err(|_| format!("VNC session '{session_id}' input channel is closed"))
    }

    fn queue_loop_input(&self, session_id: &str, event: VncLoopInput) -> Result<(), String> {
        let sessions = self.lock_sessions()?;
        let input = sessions
            .get(session_id)
            .map(|session| session.input.clone())
            .ok_or_else(|| format!("VNC session '{session_id}' was not found"))?;
        input
            .send(event)
            .map_err(|_| format!("VNC session '{session_id}' input channel is closed"))
    }

    fn lock_sessions(&self) -> Result<MutexGuard<'_, HashMap<String, VncSession>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "VNC session lock is poisoned".to_string())
    }
}

impl StartVncSessionRequest {
    pub(crate) fn secret_owner_id(&self) -> Option<&str> {
        self.secret_owner_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    pub(crate) fn password(&self) -> Option<&str> {
        self.password.as_deref().filter(|value| !value.is_empty())
    }

    pub(crate) fn set_password(&mut self, password: Option<String>) {
        self.password = password;
    }
}

async fn resolve_vnc_address(host: &str, port: u16) -> Result<SocketAddr, String> {
    let mut addresses = time::timeout(VNC_RESOLVE_TIMEOUT, lookup_host((host, port)))
        .await
        .map_err(|_| format!("timed out resolving VNC host '{host}'"))?
        .map_err(|error| format!("failed to resolve VNC host '{host}': {error}"))?;
    addresses
        .next()
        .ok_or_else(|| format!("VNC host '{host}' did not resolve to an address"))
}

async fn connect_vnc(
    address: SocketAddr,
    username: Option<String>,
    password: Option<String>,
    options: &VncSessionOptions,
    performance: EffectiveVncPerformance,
    pixel_format: PixelFormat,
) -> Result<vnc::VncClient, String> {
    connect_vnc_with_timeout(
        address,
        username,
        password,
        options,
        performance,
        pixel_format,
        VNC_CONNECT_TIMEOUT,
    )
    .await
}

async fn connect_vnc_with_timeout(
    address: SocketAddr,
    username: Option<String>,
    password: Option<String>,
    options: &VncSessionOptions,
    performance: EffectiveVncPerformance,
    pixel_format: PixelFormat,
    timeout: Duration,
) -> Result<vnc::VncClient, String> {
    time::timeout(
        timeout,
        connect_vnc_unbounded(
            address,
            username,
            password,
            options,
            performance,
            pixel_format,
        ),
    )
    .await
    .map_err(|_| format!("timed out connecting to VNC server {address}"))?
}

async fn connect_vnc_unbounded(
    address: SocketAddr,
    username: Option<String>,
    password: Option<String>,
    options: &VncSessionOptions,
    performance: EffectiveVncPerformance,
    pixel_format: PixelFormat,
) -> Result<vnc::VncClient, String> {
    let stream = TcpStream::connect(address)
        .await
        .map_err(|error| format!("failed to connect to VNC server {address}: {error}"))?;
    stream
        .set_nodelay(true)
        .map_err(|error| format!("failed to configure VNC TCP_NODELAY for {address}: {error}"))?;
    let password = Arc::new(password.unwrap_or_default());
    let password_for_auth = Arc::clone(&password);
    let mut connector = VncConnector::new(stream)
        .set_auth_method(async move { Ok((*password_for_auth).clone()) })
        .allow_shared(options.shared_session)
        .set_pixel_format(pixel_format);
    if let Some(username) = username {
        connector = connector.set_username(username);
    }
    for encoding in vnc_encoding_ids(performance, pixel_format) {
        connector = connector.add_encoding_id(encoding);
    }
    connector
        .build()
        .map_err(to_vnc_error)?
        .try_start()
        .await
        .map_err(to_vnc_error)?
        .finish()
        .map_err(to_vnc_error)
}

fn vnc_encoding_ids(
    performance: EffectiveVncPerformance,
    pixel_format: PixelFormat,
) -> Vec<i32> {
    let supports_tight_decoder = pixel_format.bits_per_pixel == 32;
    let mut encodings = match (performance.preferred_encoding, supports_tight_decoder) {
        ("raw", true) => vec![VncEncoding::Raw, VncEncoding::Tight, VncEncoding::Zrle],
        ("zrle", true) => vec![VncEncoding::Zrle, VncEncoding::Tight, VncEncoding::Raw],
        (_, true) => vec![VncEncoding::Tight, VncEncoding::Zrle, VncEncoding::Raw],
        ("raw", false) => vec![VncEncoding::Raw, VncEncoding::Zrle],
        _ => vec![VncEncoding::Zrle, VncEncoding::Raw],
    }
    .into_iter()
    .map(|encoding| encoding as i32)
    .collect::<Vec<_>>();
    if supports_tight_decoder && !performance.automatic {
        encodings.push(
            TIGHT_COMPRESSION_LEVEL_BASE + i32::from(performance.compression_level),
        );
        if performance.jpeg_enabled {
            encodings.push(TIGHT_JPEG_QUALITY_LEVEL_BASE + i32::from(performance.jpeg_quality));
        }
    }
    encodings.push(VncEncoding::CopyRect as i32);
    if pixel_format.bits_per_pixel == 32 {
        encodings.push(VncEncoding::CursorPseudo as i32);
    }
    encodings.push(VncEncoding::DesktopSizePseudo as i32);
    encodings
}

fn key_input(keycode: u32, down: bool) -> X11Event {
    X11Event::KeyEvent(ClientKeyEvent { keycode, down })
}

impl Default for VncSessionOptions {
    fn default() -> Self {
        Self {
            shared_session: true,
            view_only: false,
            color_level: default_vnc_color_level(),
            preferred_encoding: default_vnc_preferred_encoding(),
            performance_preset: default_vnc_performance_preset(),
            compression_level: default_vnc_compression_level(),
            jpeg_quality: default_vnc_jpeg_quality(),
            jpeg_enabled: true,
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_vnc_color_level() -> String {
    "full".to_string()
}

fn default_vnc_preferred_encoding() -> String {
    "tight".to_string()
}

fn default_vnc_performance_preset() -> String {
    "auto".to_string()
}

fn default_vnc_compression_level() -> u8 {
    2
}

fn default_vnc_jpeg_quality() -> u8 {
    7
}

fn validate_vnc_session_options(options: &VncSessionOptions) -> Result<(), String> {
    if options.compression_level > 9 {
        return Err("VNC compression level must be between 0 and 9".to_string());
    }
    if options.jpeg_quality > 9 {
        return Err("VNC JPEG quality must be between 0 and 9".to_string());
    }
    match options.performance_preset.as_str() {
        "auto" | "lan" | "balanced" | "lowBandwidth" | "lossless" | "custom" => Ok(()),
        _ => Err("VNC performance preset is not recognized".to_string()),
    }
}

fn effective_vnc_performance(options: &VncSessionOptions) -> EffectiveVncPerformance {
    match options.performance_preset.as_str() {
        "lan" => EffectiveVncPerformance {
            automatic: false,
            preferred_encoding: "tight",
            color_level: "full",
            compression_level: 1,
            jpeg_quality: 8,
            jpeg_enabled: true,
        },
        "balanced" => EffectiveVncPerformance {
            automatic: false,
            preferred_encoding: "tight",
            color_level: "full",
            compression_level: 2,
            jpeg_quality: 7,
            jpeg_enabled: true,
        },
        "lowBandwidth" => EffectiveVncPerformance {
            automatic: false,
            preferred_encoding: "tight",
            color_level: "full",
            compression_level: 6,
            jpeg_quality: 4,
            jpeg_enabled: true,
        },
        "lossless" => EffectiveVncPerformance {
            automatic: false,
            preferred_encoding: "zrle",
            color_level: "full",
            compression_level: 2,
            jpeg_quality: 9,
            jpeg_enabled: false,
        },
        "custom" => EffectiveVncPerformance {
            automatic: false,
            preferred_encoding: match options.preferred_encoding.as_str() {
                "raw" => "raw",
                "zrle" => "zrle",
                _ => "tight",
            },
            color_level: match options.color_level.as_str() {
                "256" => "256",
                "64" => "64",
                "8" => "8",
                _ => "full",
            },
            compression_level: options.compression_level,
            jpeg_quality: options.jpeg_quality,
            jpeg_enabled: options.jpeg_enabled,
        },
        // Automatic delegates final Tight heuristics to the server while
        // supplying a moderate quality ceiling and preserving full colour.
        _ => EffectiveVncPerformance {
            automatic: true,
            preferred_encoding: "tight",
            color_level: "full",
            compression_level: 2,
            jpeg_quality: 7,
            jpeg_enabled: true,
        },
    }
}

fn pixel_format_for(color_level: &str) -> PixelFormat {
    match color_level {
        "256" => reduced_pixel_format(8, 7, 7, 3, 5, 2, 0),
        "64" => reduced_pixel_format(6, 3, 3, 3, 4, 2, 0),
        "8" => reduced_pixel_format(3, 1, 1, 1, 2, 1, 0),
        _ => PixelFormat::rgba(),
    }
}

fn reduced_pixel_format(
    depth: u8,
    red_max: u16,
    green_max: u16,
    blue_max: u16,
    red_shift: u8,
    green_shift: u8,
    blue_shift: u8,
) -> PixelFormat {
    let mut format = PixelFormat::rgba();
    format.bits_per_pixel = 8;
    format.depth = depth;
    format.big_endian_flag = 0;
    format.true_color_flag = 1;
    format.red_max = red_max;
    format.green_max = green_max;
    format.blue_max = blue_max;
    format.red_shift = red_shift;
    format.green_shift = green_shift;
    format.blue_shift = blue_shift;
    format
}

fn spawn_vnc_event_loop(
    runtime: &Runtime,
    app: AppHandle,
    session_id: String,
    client: vnc::VncClient,
    mut input_rx: mpsc::UnboundedReceiver<VncLoopInput>,
    mut pointer_rx: watch::Receiver<Option<ClientMouseEvent>>,
    frames: Arc<Mutex<VncFrameCache>>,
    mut pixel_format: PixelFormat,
    mut stop: oneshot::Receiver<()>,
) {
    runtime.spawn(async move {
        eprintln!("[vnc {session_id}] event loop starting");
        emit_vnc_event(
            &app,
            VncSessionEvent::Connected {
                session_id: session_id.clone(),
                name: "VNC".to_string(),
            },
        );
        // vnc-rs queued the initial non-incremental update during connection
        // setup. Do not send another request until that update is painted.
        let mut request_in_flight = true;
        let mut awaiting_frame_ack = None;
        let mut batch = VncFrameBatch::default();
        let mut next_frame_id = 1_u64;
        let mut framebuffer_width = 0_u16;
        let mut framebuffer_height = 0_u16;
        loop {
            tokio::select! {
                _ = &mut stop => {
                    eprintln!("[vnc {session_id}] stop signal received");
                    let _ = client.close().await;
                    break;
                }
                input = input_rx.recv() => {
                    match input {
                        Some(VncLoopInput::Protocol(input @ (X11Event::Refresh | X11Event::FullRefresh))) => {
                            if let Some(request) = take_vnc_refresh_request(
                                input,
                                request_in_flight,
                                &mut awaiting_frame_ack,
                            ) {
                                if let Err(error) = client.input(request).await {
                                    emit_vnc_event(&app, VncSessionEvent::Error {
                                        session_id: session_id.clone(),
                                        message: to_vnc_error(error),
                                    });
                                    break;
                                }
                                request_in_flight = true;
                            }
                        }
                        Some(VncLoopInput::Protocol(input)) => {
                            if let Err(error) = client.input(input).await {
                                eprintln!("[vnc {session_id}] queued input failed: {error}");
                                emit_vnc_event(&app, VncSessionEvent::Error {
                                    session_id: session_id.clone(),
                                    message: to_vnc_error(error),
                                });
                                break;
                            }
                        }
                        Some(VncLoopInput::FramePainted(frame_id)) => {
                            if awaiting_frame_ack == Some(frame_id) {
                                awaiting_frame_ack = None;
                                if let Err(error) = client.input(X11Event::Refresh).await {
                                    emit_vnc_event(&app, VncSessionEvent::Error {
                                        session_id: session_id.clone(),
                                        message: to_vnc_error(error),
                                    });
                                    break;
                                }
                                request_in_flight = true;
                            }
                        }
                        None => break,
                    }
                }
                pointer_changed = pointer_rx.changed() => {
                    if pointer_changed.is_err() {
                        break;
                    }
                    let pointer = pointer_rx.borrow_and_update().clone();
                    if let Some(pointer) = pointer {
                        if let Err(error) = client.input(X11Event::PointerEvent(pointer)).await {
                            emit_vnc_event(&app, VncSessionEvent::Error {
                                session_id: session_id.clone(),
                                message: to_vnc_error(error),
                            });
                            break;
                        }
                    }
                }
                event = client.recv_event() => {
                    match event {
                        Ok(VncEvent::SetPixelFormat(format)) => {
                            pixel_format = format;
                        }
                        Ok(VncEvent::FramebufferUpdateComplete(metrics)) => {
                            request_in_flight = false;
                            let frame_id = next_frame_id;
                            next_frame_id += 1;
                            let operation_count = batch.operations.len();
                            let bridge_started = std::time::Instant::now();
                            let bytes = encode_vnc_frame_batch(std::mem::take(&mut batch));
                            let bridge_micros = bridge_started.elapsed().as_micros() as u64;
                            let payload_bytes = bytes.len();
                            let cache_result = frames
                                .lock()
                                .map_err(|_| "VNC frame cache lock is poisoned".to_string())
                                .map(|mut cache| {
                                    cache.frames.push_back(CachedVncFrame { id: frame_id, bytes });
                                    while cache.frames.len() > VNC_FRAME_CACHE_SIZE {
                                        cache.frames.pop_front();
                                    }
                                });
                            if let Err(message) = cache_result {
                                emit_vnc_event(&app, VncSessionEvent::Error {
                                    session_id: session_id.clone(),
                                    message,
                                });
                                break;
                            }
                            awaiting_frame_ack = Some(frame_id);
                            emit_vnc_event(&app, VncSessionEvent::FrameAvailable {
                                session_id: session_id.clone(),
                                frame_id,
                                width: framebuffer_width,
                                height: framebuffer_height,
                                payload_bytes,
                                operation_count,
                                wire_bytes: metrics.wire_bytes,
                                decode_micros: metrics.decode_micros,
                                bridge_micros,
                                rectangles: metrics.rectangles,
                                raw_rectangles: metrics.raw_rectangles,
                                copy_rectangles: metrics.copy_rectangles,
                                tight_rectangles: metrics.tight_rectangles,
                                zrle_rectangles: metrics.zrle_rectangles,
                                trle_rectangles: metrics.trle_rectangles,
                                cursor_rectangles: metrics.cursor_rectangles,
                                desktop_size_rectangles: metrics.desktop_size_rectangles,
                            });
                        }
                        Ok(VncEvent::SetResolution(screen)) => {
                            framebuffer_width = screen.width;
                            framebuffer_height = screen.height;
                            emit_vnc_event(
                                &app,
                                VncSessionEvent::Resolution {
                                    session_id: session_id.clone(),
                                    width: screen.width,
                                    height: screen.height,
                                },
                            );
                        }
                        Ok(event) => handle_vnc_event(
                            &app,
                            &session_id,
                            event,
                            pixel_format,
                            &mut batch,
                        ),
                        Err(error) => {
                            eprintln!("[vnc {session_id}] recv_event failed: {error}");
                            emit_vnc_event(&app, VncSessionEvent::Error {
                                session_id: session_id.clone(),
                                message: to_vnc_error(error),
                            });
                            break;
                        }
                    }
                }
            }
        }
        eprintln!("[vnc {session_id}] event loop exiting");
        emit_vnc_event(&app, VncSessionEvent::Disconnected { session_id });
    });
}

fn handle_vnc_event(
    app: &AppHandle,
    session_id: &str,
    event: VncEvent,
    pixel_format: PixelFormat,
    batch: &mut VncFrameBatch,
) {
    match event {
        VncEvent::SetResolution(screen) => emit_vnc_event(
            app,
            VncSessionEvent::Resolution {
                session_id: session_id.to_string(),
                width: screen.width,
                height: screen.height,
            },
        ),
        VncEvent::RawImage(rect, data) => batch.operations.push(VncFrameOperation::Raw {
            rect,
            rgba: raw_pixels_to_rgba(&data, pixel_format),
        }),
        VncEvent::JpegImage(rect, bytes) => batch
            .operations
            .push(VncFrameOperation::Jpeg { rect, bytes }),
        VncEvent::Copy(dst, src) => batch
            .operations
            .push(VncFrameOperation::Copy { dst, src }),
        VncEvent::Bell => emit_vnc_event(
            app,
            VncSessionEvent::Bell {
                session_id: session_id.to_string(),
            },
        ),
        VncEvent::Text(text) => emit_vnc_event(
            app,
            VncSessionEvent::ClipboardText {
                session_id: session_id.to_string(),
                text,
            },
        ),
        VncEvent::Error(message) => emit_vnc_event(
            app,
            VncSessionEvent::Error {
                session_id: session_id.to_string(),
                message,
            },
        ),
        VncEvent::SetCursor(rect, data) => emit_vnc_event(
            app,
            VncSessionEvent::SetCursor {
                session_id: session_id.to_string(),
                width: rect.width,
                height: rect.height,
                hot_x: rect.x,
                hot_y: rect.y,
                rgba: BASE64.encode(data),
            },
        ),
        VncEvent::SetPixelFormat(_) | VncEvent::FramebufferUpdateComplete(_) => {}
        _ => {}
    }
}

fn encode_vnc_frame_batch(batch: VncFrameBatch) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(VNC_FRAME_MAGIC);
    bytes.extend_from_slice(&VNC_FRAME_VERSION.to_le_bytes());
    bytes.extend_from_slice(&(batch.operations.len() as u16).to_le_bytes());
    for operation in batch.operations {
        let (kind, rect, source_x, source_y, payload) = match operation {
            VncFrameOperation::Raw { rect, rgba } => (0_u8, rect, 0, 0, rgba),
            VncFrameOperation::Jpeg { rect, bytes } => (1_u8, rect, 0, 0, bytes),
            VncFrameOperation::Copy { dst, src } => (2_u8, dst, src.x, src.y, Vec::new()),
        };
        bytes.push(kind);
        bytes.push(0);
        bytes.extend_from_slice(&rect.x.to_le_bytes());
        bytes.extend_from_slice(&rect.y.to_le_bytes());
        bytes.extend_from_slice(&rect.width.to_le_bytes());
        bytes.extend_from_slice(&rect.height.to_le_bytes());
        bytes.extend_from_slice(&source_x.to_le_bytes());
        bytes.extend_from_slice(&source_y.to_le_bytes());
        bytes.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&payload);
    }
    bytes
}

fn emit_vnc_event(app: &AppHandle, event: VncSessionEvent) {
    let _ = app.emit("vnc-session-event", event);
}

fn raw_pixels_to_rgba(data: &[u8], format: PixelFormat) -> Vec<u8> {
    let bytes_per_pixel = usize::from(format.bits_per_pixel / 8);
    if bytes_per_pixel == 0 {
        return Vec::new();
    }
    let mut rgba = Vec::with_capacity((data.len() / bytes_per_pixel) * 4);
    for pixel in data.chunks_exact(bytes_per_pixel) {
        let value = pixel_value(pixel, format.big_endian_flag != 0);
        rgba.push(scale_color_component(
            (value >> format.red_shift) & u32::from(format.red_max),
            format.red_max,
        ));
        rgba.push(scale_color_component(
            (value >> format.green_shift) & u32::from(format.green_max),
            format.green_max,
        ));
        rgba.push(scale_color_component(
            (value >> format.blue_shift) & u32::from(format.blue_max),
            format.blue_max,
        ));
        rgba.push(255);
    }
    rgba
}

fn pixel_value(pixel: &[u8], big_endian: bool) -> u32 {
    let mut value = 0_u32;
    if big_endian {
        for byte in pixel {
            value = (value << 8) | u32::from(*byte);
        }
    } else {
        for (index, byte) in pixel.iter().enumerate() {
            value |= u32::from(*byte) << (index * 8);
        }
    }
    value
}

fn scale_color_component(value: u32, max: u16) -> u8 {
    if max == 0 {
        return 0;
    }
    ((value * 255) / u32::from(max)) as u8
}

fn to_vnc_error(error: impl std::fmt::Display) -> String {
    format!("VNC error: {error}")
}

fn required_id(value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("VNC session id is required".to_string());
    }
    if trimmed.len() > 96 {
        return Err("VNC session id must be 96 characters or fewer".to_string());
    }
    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("VNC session id may only contain letters, digits, '-' or '_'".to_string());
    }
    Ok(trimmed.to_string())
}

fn required_field(label: &str, value: String) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_request_accepts_optional_username() {
        let json = r#"{"sessionId":"vnc-1","host":"mac.local","username":"bob","password":"pw"}"#;
        let request: StartVncSessionRequest =
            serde_json::from_str(json).expect("request deserializes");
        assert_eq!(request.username.as_deref(), Some("bob"));
    }

    #[test]
    fn start_request_username_defaults_to_none() {
        let json = r#"{"sessionId":"vnc-1","host":"mac.local"}"#;
        let request: StartVncSessionRequest =
            serde_json::from_str(json).expect("request deserializes");
        assert!(request.username.is_none());
    }

    #[test]
    fn validates_vnc_session_ids() {
        assert_eq!(
            required_id("vnc-session_1".to_string()).as_deref(),
            Ok("vnc-session_1")
        );
        assert!(required_id("bad/session".to_string()).is_err());
    }

    #[test]
    fn uses_standard_vnc_port_when_missing() {
        assert_eq!(DEFAULT_VNC_PORT, 5900);
    }

    #[test]
    fn full_refresh_recovers_from_a_stale_frame_ack() {
        let mut awaiting_frame_ack = Some(42);

        let incremental = take_vnc_refresh_request(
            X11Event::Refresh,
            false,
            &mut awaiting_frame_ack,
        );
        assert!(incremental.is_none());
        assert_eq!(awaiting_frame_ack, Some(42));

        let request = take_vnc_refresh_request(
            X11Event::FullRefresh,
            false,
            &mut awaiting_frame_ack,
        );

        assert!(matches!(request, Some(X11Event::FullRefresh)));
        assert_eq!(awaiting_frame_ack, None);
    }

    #[test]
    fn full_refresh_bypasses_an_outstanding_incremental_request() {
        let mut awaiting_frame_ack = None;

        let request = take_vnc_refresh_request(
            X11Event::FullRefresh,
            true,
            &mut awaiting_frame_ack,
        );

        assert!(matches!(request, Some(X11Event::FullRefresh)));
    }

    #[test]
    fn vnc_connect_timeout_covers_unresponsive_server() {
        let runtime = Runtime::new().expect("runtime starts");
        runtime.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("listener binds");
            let address = listener.local_addr().expect("listener has address");
            let server = tokio::spawn(async move {
                let _accepted = listener.accept().await;
                time::sleep(Duration::from_millis(250)).await;
            });

            let result = connect_vnc_with_timeout(
                address,
                None,
                None,
                &VncSessionOptions::default(),
                effective_vnc_performance(&VncSessionOptions::default()),
                pixel_format_for("full"),
                Duration::from_millis(25),
            )
            .await;
            server.abort();

            assert_eq!(
                result.as_ref().map(|_| ()),
                Err(&format!("timed out connecting to VNC server {address}"))
            );
        });
    }

    #[test]
    fn serializes_frame_rectangles_into_the_binary_batch() {
        let bytes = encode_vnc_frame_batch(VncFrameBatch {
            operations: vec![VncFrameOperation::Raw {
                rect: vnc::Rect {
                    x: 1,
                    y: 2,
                    width: 1,
                    height: 1,
                },
                rgba: vec![255, 0, 0, 255],
            }],
        });
        assert_eq!(&bytes[..4], VNC_FRAME_MAGIC);
        assert_eq!(u16::from_le_bytes([bytes[6], bytes[7]]), 1);
        assert_eq!(&bytes[bytes.len() - 4..], &[255, 0, 0, 255]);
    }

    #[test]
    fn frame_notifications_carry_the_retained_framebuffer_size() {
        let event = VncSessionEvent::FrameAvailable {
            session_id: "vnc-1".to_string(),
            frame_id: 1,
            width: 800,
            height: 600,
            payload_bytes: 4,
            operation_count: 1,
            wire_bytes: 4,
            decode_micros: 0,
            bridge_micros: 0,
            rectangles: 1,
            raw_rectangles: 1,
            copy_rectangles: 0,
            tight_rectangles: 0,
            zrle_rectangles: 0,
            trle_rectangles: 0,
            cursor_rectangles: 0,
            desktop_size_rectangles: 0,
        };
        let json = serde_json::to_value(event).expect("frame event serializes");

        assert_eq!(json["width"], 800);
        assert_eq!(json["height"], 600);
    }

    #[test]
    fn vnc_color_level_selects_matching_pixel_format() {
        assert_eq!(pixel_format_for("full").bits_per_pixel, 32);
        assert_eq!(pixel_format_for("256").depth, 8);
        assert_eq!(pixel_format_for("64").depth, 6);
        assert_eq!(pixel_format_for("8").depth, 3);
    }

    #[test]
    fn converts_reduced_vnc_pixels_to_rgba() {
        let rgb332 = pixel_format_for("256");
        assert_eq!(
            raw_pixels_to_rgba(&[0b1110_0011, 0], rgb332),
            vec![255, 0, 255, 255, 0, 0, 0, 255]
        );
    }

    #[test]
    fn auto_tuning_leaves_tight_quality_selection_to_the_server() {
        let performance = effective_vnc_performance(&VncSessionOptions::default());
        let encodings = vnc_encoding_ids(performance, pixel_format_for("full"));
        assert_eq!(encodings[0], VncEncoding::Tight as i32);
        assert!(!encodings.contains(&(TIGHT_COMPRESSION_LEVEL_BASE + 2)));
        assert!(!encodings.contains(&(TIGHT_JPEG_QUALITY_LEVEL_BASE + 7)));
    }

    #[test]
    fn balanced_tuning_advertises_explicit_tight_levels() {
        let performance = effective_vnc_performance(&VncSessionOptions {
            performance_preset: "balanced".to_string(),
            ..VncSessionOptions::default()
        });
        let encodings = vnc_encoding_ids(performance, pixel_format_for("full"));
        assert!(encodings.contains(&(TIGHT_COMPRESSION_LEVEL_BASE + 2)));
        assert!(encodings.contains(&(TIGHT_JPEG_QUALITY_LEVEL_BASE + 7)));
    }

    #[test]
    fn reduced_color_avoids_the_full_color_only_tight_decoder() {
        let performance = effective_vnc_performance(&VncSessionOptions {
            performance_preset: "custom".to_string(),
            color_level: "256".to_string(),
            ..VncSessionOptions::default()
        });
        let encodings = vnc_encoding_ids(performance, pixel_format_for("256"));
        assert_eq!(encodings[0], VncEncoding::Zrle as i32);
        assert!(!encodings.contains(&(VncEncoding::Tight as i32)));
    }
}

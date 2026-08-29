use crate::sessions::emit_terminal_output;
use serde_json::{Value, json};
use serial2::SerialPort;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::AppHandle;

pub struct NativeSerialTerminal {
    writer: SerialPort,
    session_id: String,
    closed: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct NativeSerialTerminalRequest {
    pub session_id: String,
    pub line: String,
    pub speed: u32,
    pub encoding: crate::sessions::TerminalEncodingState,
}

const MACOS_SERIAL_CALLOUT_PREFIX: &str = "/dev/cu.";
const MACOS_SERIAL_DIAL_IN_PREFIX: &str = "/dev/tty.";
const SERIAL_READ_TIMEOUT: Duration = Duration::from_millis(250);
const SERIAL_WRITE_TIMEOUT: Duration = Duration::from_secs(5);
// `serial2` polls for `POLLIN` but accepts any `revents`, so a `POLLHUP` or
// `POLLERR` blip on the tty surfaces as a zero-byte read instead of an error.
// Ending the reader thread on the first one left a Pane that still reported a
// live Session while nothing could ever arrive again (issue #745). Only a line
// that stays hung up across this many polls is treated as a real end.
const SERIAL_EMPTY_READ_BACKOFF: Duration = Duration::from_millis(50);
const SERIAL_EMPTY_READS_BEFORE_HANGUP: u32 = 40;

impl NativeSerialTerminal {
    pub fn write_input(&mut self, data: Vec<u8>) -> Result<(), String> {
        let byte_count = data.len();
        let result = self
            .writer
            .write_all(&data)
            .map_err(|error| format!("failed to write serial input: {error}"))
            .and_then(|()| {
                self.writer
                    .flush()
                    .map_err(|error| format!("failed to flush serial input: {error}"))
            });
        match &result {
            Ok(()) => serial_debug(
                "serial.input_written",
                json!({ "sessionId": self.session_id, "byteCount": byte_count }),
            ),
            Err(error) => serial_debug(
                "serial.input_failed",
                json!({
                    "sessionId": self.session_id,
                    "byteCount": byte_count,
                    "error": error,
                }),
            ),
        }
        result
    }

    pub fn close(self) {
        self.closed.store(true, Ordering::Relaxed);
        serial_debug("serial.closed", json!({ "sessionId": self.session_id }));
    }
}

fn serial_debug(event: &str, payload: Value) {
    crate::logging::serial_debug(event, &payload);
}

/// The line settings the OS reports back once the port is configured.
///
/// A serial Pane that shows only mojibake is almost always a speed or framing
/// mismatch, and nothing in KKTerm used to say what had actually been applied.
/// This summary feeds both the connect banner and `serial.debug.log`.
struct AppliedSerialSettings {
    speed: Option<u32>,
    char_size: Option<u8>,
    parity: Option<&'static str>,
    stop_bits: Option<u8>,
    flow_control: Option<&'static str>,
    cts: Option<bool>,
    dsr: Option<bool>,
    carrier_detect: Option<bool>,
}

impl AppliedSerialSettings {
    fn read_from(port: &SerialPort) -> Self {
        let settings = port.get_configuration().ok();
        Self {
            speed: settings.as_ref().and_then(|it| it.get_baud_rate().ok()),
            char_size: settings
                .as_ref()
                .and_then(|it| it.get_char_size().ok())
                .map(|size| size.as_u8()),
            parity: settings
                .as_ref()
                .and_then(|it| it.get_parity().ok())
                .map(|parity| parity.as_str()),
            stop_bits: settings
                .as_ref()
                .and_then(|it| it.get_stop_bits().ok())
                .map(|bits| bits.as_u8()),
            flow_control: settings
                .as_ref()
                .and_then(|it| it.get_flow_control().ok())
                .map(|flow| flow.as_str()),
            cts: port.read_cts().ok(),
            dsr: port.read_dsr().ok(),
            carrier_detect: port.read_cd().ok(),
        }
    }

    fn to_json(&self) -> Value {
        json!({
            "speed": self.speed,
            "charSize": self.char_size,
            "parity": self.parity,
            "stopBits": self.stop_bits,
            "flowControl": self.flow_control,
            "cts": self.cts,
            "dsr": self.dsr,
            "carrierDetect": self.carrier_detect,
        })
    }
}

/// `115200 8N1` style framing summary, with `?` standing in for anything the OS
/// declined to report.
fn serial_framing_summary(
    speed: Option<u32>,
    char_size: Option<u8>,
    parity: Option<&str>,
    stop_bits: Option<u8>,
) -> String {
    fn or_unknown<T: std::fmt::Display>(value: Option<T>) -> String {
        value.map_or_else(|| "?".to_string(), |value| value.to_string())
    }
    let parity = match parity {
        Some("none") => "N",
        Some("odd") => "O",
        Some("even") => "E",
        _ => "?",
    };
    format!(
        "{} {}{}{}",
        or_unknown(speed),
        or_unknown(char_size),
        parity,
        or_unknown(stop_bits),
    )
}

/// Enumerate serial ports the OS currently exposes.
///
/// Backed by `serial2`, which scans IOKit on macOS (including both `/dev/cu.*`
/// callout devices and `/dev/tty.*` dial-in devices), `/sys/class/tty` on Linux
/// (`/dev/ttyUSB*`, `/dev/ttyACM*`, …) and the `SERIALCOMM` registry on Windows
/// (`COM*`). KKTerm exposes only macOS callout devices because opening a `/dev/tty.*`
/// dial-in device can wait for carrier detection. Enumeration is best-effort: on
/// any error we return an empty list so callers can still fall back to manual entry.
pub fn available_serial_ports() -> Vec<String> {
    normalize_available_serial_ports(
        SerialPort::available_ports()
            .unwrap_or_default()
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned()),
        cfg!(target_os = "macos"),
    )
}

fn normalize_available_serial_ports(
    paths: impl IntoIterator<Item = String>,
    macos: bool,
) -> Vec<String> {
    let mut ports: Vec<String> = paths
        .into_iter()
        .filter(|path| !macos || path.starts_with(MACOS_SERIAL_CALLOUT_PREFIX))
        .collect();
    ports.sort();
    ports.dedup();
    ports
}

fn validate_serial_line(line: &str, macos: bool) -> Result<&str, String> {
    let line = line.trim();
    if line.is_empty() {
        return Err("serial line is required".to_string());
    }
    // Only the dial-in twin is rejected: it waits for carrier detection. Anything
    // else stays open to manual entry, including PTY-backed virtual ports such as
    // /dev/ttys004, which have no dot and no /dev/cu.* counterpart.
    if macos && line.starts_with(MACOS_SERIAL_DIAL_IN_PREFIX) {
        return Err(format!(
            "macOS serial lines must use a {MACOS_SERIAL_CALLOUT_PREFIX}* callout device, not a {MACOS_SERIAL_DIAL_IN_PREFIX}* dial-in device"
        ));
    }
    Ok(line)
}

#[cfg(target_os = "macos")]
fn is_macos_standard_baud_rate(speed: u32) -> bool {
    matches!(
        speed,
        50 | 75
            | 110
            | 134
            | 150
            | 200
            | 300
            | 600
            | 1200
            | 1800
            | 2400
            | 4800
            | 7200
            | 9600
            | 14400
            | 19200
            | 28800
            | 38400
            | 57600
            | 76800
            | 115200
            | 230400
    )
}

#[cfg(target_os = "macos")]
fn open_serial_port(line: &str, speed: u32) -> std::io::Result<SerialPort> {
    use serial2::KeepSettings;
    use std::os::fd::AsRawFd;

    let mut port = SerialPort::open(line, KeepSettings)?;
    let mut settings = port.get_configuration()?;
    settings.set_raw();
    settings.set_baud_rate(speed)?;

    if is_macos_standard_baud_rate(speed) {
        // Standard macOS rates must use their native termios constants. `serial2`
        // otherwise routes every speed through IOSSIOSPEED, first applying 9600
        // with tcsetattr. Some USB-serial drivers report the requested value after
        // that sequence but still sample the wire at the wrong rate (issue #756).
        // screen, Chromium, picocom, and node-serialport all reserve IOSSIOSPEED
        // for rates that do not have a standard termios constant.
        let result =
            unsafe { libc::tcsetattr(port.as_raw_fd(), libc::TCSANOW, settings.as_termios()) };
        if result != 0 {
            return Err(std::io::Error::last_os_error());
        }
    } else {
        // Keep arbitrary-rate support: IOSSIOSPEED is the macOS API for values
        // that cannot be represented by a native termios baud constant.
        port.set_configuration(&settings)?;
    }

    Ok(port)
}

#[cfg(not(target_os = "macos"))]
fn open_serial_port(line: &str, speed: u32) -> std::io::Result<SerialPort> {
    SerialPort::open(line, speed)
}

pub fn start_native_terminal(
    app: AppHandle,
    request: NativeSerialTerminalRequest,
) -> Result<NativeSerialTerminal, String> {
    let line = validate_serial_line(&request.line, cfg!(target_os = "macos"))?;
    if request.speed == 0 {
        return Err("serial speed must be greater than 0".to_string());
    }

    serial_debug(
        "serial.open_requested",
        json!({
            "sessionId": request.session_id,
            "line": line,
            "speed": request.speed,
            "encoding": request.encoding.label(),
        }),
    );

    let mut port = open_serial_port(line, request.speed).map_err(|error| {
        serial_debug(
            "serial.open_failed",
            json!({
                "sessionId": request.session_id,
                "line": line,
                "error": error.to_string(),
            }),
        );
        format!("failed to open serial line {line}: {error}")
    })?;
    port.set_read_timeout(SERIAL_READ_TIMEOUT)
        .map_err(|error| format!("failed to configure serial read timeout: {error}"))?;
    port.set_write_timeout(SERIAL_WRITE_TIMEOUT)
        .map_err(|error| format!("failed to configure serial write timeout: {error}"))?;
    let _ = port.set_dtr(true);
    let _ = port.set_rts(true);
    // Applying the line settings can itself leave bytes in the receive queue. For
    // a non-standard macOS rate, `serial2` has to write the termios struct at 9600
    // first and only then switch with IOSSIOSPEED, so bytes sent during that window
    // are sampled at the wrong rate. Reading them back painted the Pane with a
    // burst of mojibake before the first real byte (issue #745); drop them instead.
    let _ = port.discard_input_buffer();

    let applied = AppliedSerialSettings::read_from(&port);
    serial_debug(
        "serial.opened",
        json!({
            "sessionId": request.session_id,
            "line": line,
            "requestedSpeed": request.speed,
            "applied": applied.to_json(),
        }),
    );
    // Mirror what `screen` and `minicom` print on connect. A speed or framing
    // mismatch is the most common reason a serial Pane looks dead, and this is
    // the only place the user can see what the OS actually applied.
    emit_terminal_output(
        &app,
        &request.session_id,
        format!(
            "\r\n[serial {line} {} flow={}]\r\n",
            serial_framing_summary(
                applied.speed,
                applied.char_size,
                applied.parity,
                applied.stop_bits,
            ),
            applied.flow_control.unwrap_or("?"),
        ),
    );

    let reader = port
        .try_clone()
        .map_err(|error| format!("failed to create serial reader: {error}"))?;
    let session_id = request.session_id.clone();
    let closed = Arc::new(AtomicBool::new(false));
    let reader_closed = Arc::clone(&closed);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut decoder = crate::sessions::TerminalOutputDecoder::new(request.encoding.clone());
        let mut empty_reads = 0_u32;
        let mut byte_count = 0_u64;
        let end_reason = loop {
            if reader_closed.load(Ordering::Relaxed) {
                break None;
            }
            match reader.read(&mut buffer) {
                Ok(0) => {
                    empty_reads += 1;
                    if empty_reads >= SERIAL_EMPTY_READS_BEFORE_HANGUP {
                        break Some("serial line hung up".to_string());
                    }
                    std::thread::sleep(SERIAL_EMPTY_READ_BACKOFF);
                }
                Ok(count) => {
                    empty_reads = 0;
                    byte_count += count as u64;
                    if let Some(text) = decoder.decode(&buffer[..count]) {
                        emit_terminal_output(&app, &request.session_id, text);
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    // A real poll timeout means the line is healthy and idle.
                    empty_reads = 0;
                }
                Err(error) => break Some(format!("serial read error: {error}")),
            }
        };
        if let Some(text) = decoder.finish_lossy() {
            emit_terminal_output(&app, &request.session_id, text);
        }
        if let Some(reason) = &end_reason {
            emit_terminal_output(&app, &request.session_id, format!("\r\n[{reason}]\r\n"));
        }
        serial_debug(
            "serial.reader_stopped",
            json!({
                "sessionId": request.session_id,
                "byteCount": byte_count,
                "reason": end_reason.as_deref().unwrap_or("closed"),
            }),
        );
        // Unplugging a USB adapter (or any read error) only ends this thread. Without
        // the same session-ended signal telnet and SSH emit, the pane keeps reporting
        // a live Session: keystrokes go nowhere and no reconnect is offered.
        crate::sessions::emit_terminal_session_ended(&app, &request.session_id);
    });

    Ok(NativeSerialTerminal {
        writer: port,
        session_id,
        closed,
    })
}

#[cfg(test)]
mod tests {
    use super::{normalize_available_serial_ports, serial_framing_summary, validate_serial_line};

    #[cfg(target_os = "macos")]
    use super::is_macos_standard_baud_rate;

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_uses_termios_for_native_baud_rates() {
        assert!(is_macos_standard_baud_rate(115200));
        assert!(is_macos_standard_baud_rate(230400));
        assert!(!is_macos_standard_baud_rate(250000));
    }

    #[test]
    fn macos_serial_line_rejects_dial_in_devices() {
        assert_eq!(
            validate_serial_line(" /dev/cu.usbserial-A ", true),
            Ok("/dev/cu.usbserial-A"),
        );
        assert!(validate_serial_line("/dev/tty.usbserial-A", true).is_err());
        // PTY-backed virtual ports have no dial-in twin to prefer.
        assert_eq!(
            validate_serial_line("/dev/ttys004", true),
            Ok("/dev/ttys004")
        );
    }

    #[test]
    fn non_macos_serial_line_keeps_manual_paths_available() {
        assert_eq!(
            validate_serial_line(" /dev/ttyUSB0 ", false),
            Ok("/dev/ttyUSB0"),
        );
    }

    #[test]
    fn macos_serial_enumeration_exposes_only_callout_devices() {
        assert_eq!(
            normalize_available_serial_ports(
                vec![
                    "/dev/tty.usbserial-A".to_string(),
                    "/dev/cu.usbserial-A".to_string(),
                    "/dev/cu.Bluetooth-Incoming-Port".to_string(),
                    "/dev/cu.usbserial-A".to_string(),
                ],
                true,
            ),
            vec![
                "/dev/cu.Bluetooth-Incoming-Port".to_string(),
                "/dev/cu.usbserial-A".to_string(),
            ],
        );
    }

    #[test]
    fn non_macos_serial_enumeration_keeps_sorted_unique_paths() {
        assert_eq!(
            normalize_available_serial_ports(
                vec!["COM10".to_string(), "COM2".to_string(), "COM10".to_string()],
                false,
            ),
            vec!["COM10".to_string(), "COM2".to_string()],
        );
    }

    #[test]
    fn framing_summary_reads_like_a_terminal_program_banner() {
        assert_eq!(
            serial_framing_summary(Some(115200), Some(8), Some("none"), Some(1)),
            "115200 8N1",
        );
        assert_eq!(
            serial_framing_summary(Some(9600), Some(7), Some("even"), Some(2)),
            "9600 7E2",
        );
    }

    #[test]
    fn framing_summary_marks_settings_the_os_would_not_report() {
        assert_eq!(serial_framing_summary(None, None, None, None), "? ???");
    }
}

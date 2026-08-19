use crate::sessions::emit_terminal_output;
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

impl NativeSerialTerminal {
    pub fn write_input(&mut self, data: Vec<u8>) -> Result<(), String> {
        self.writer
            .write_all(&data)
            .map_err(|error| format!("failed to write serial input: {error}"))?;
        self.writer
            .flush()
            .map_err(|error| format!("failed to flush serial input: {error}"))
    }

    pub fn close(self) {
        self.closed.store(true, Ordering::Relaxed);
    }
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

pub fn start_native_terminal(
    app: AppHandle,
    request: NativeSerialTerminalRequest,
) -> Result<NativeSerialTerminal, String> {
    let line = validate_serial_line(&request.line, cfg!(target_os = "macos"))?;
    if request.speed == 0 {
        return Err("serial speed must be greater than 0".to_string());
    }

    let mut port = SerialPort::open(line, request.speed)
        .map_err(|error| format!("failed to open serial line {line}: {error}"))?;
    port.set_read_timeout(Duration::from_millis(250))
        .map_err(|error| format!("failed to configure serial read timeout: {error}"))?;
    port.set_write_timeout(Duration::from_secs(5))
        .map_err(|error| format!("failed to configure serial write timeout: {error}"))?;
    let _ = port.set_dtr(true);
    let _ = port.set_rts(true);

    let reader = port
        .try_clone()
        .map_err(|error| format!("failed to create serial reader: {error}"))?;
    let closed = Arc::new(AtomicBool::new(false));
    let reader_closed = Arc::clone(&closed);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut decoder = crate::sessions::TerminalOutputDecoder::new(request.encoding.clone());
        while !reader_closed.load(Ordering::Relaxed) {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
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
                    continue;
                }
                Err(error) => {
                    if let Some(text) = decoder.finish_lossy() {
                        emit_terminal_output(&app, &request.session_id, text);
                    }
                    emit_terminal_output(
                        &app,
                        &request.session_id,
                        format!("\r\n[serial read error: {error}]\r\n"),
                    );
                    break;
                }
            }
        }
        // Unplugging a USB adapter (or any read error) only ends this thread. Without
        // the same session-ended signal telnet and SSH emit, the pane keeps reporting
        // a live Session: keystrokes go nowhere and no reconnect is offered.
        crate::sessions::emit_terminal_session_ended(&app, &request.session_id);
    });

    Ok(NativeSerialTerminal {
        writer: port,
        closed,
    })
}

#[cfg(test)]
mod tests {
    use super::{normalize_available_serial_ports, validate_serial_line};

    #[test]
    fn macos_serial_line_rejects_dial_in_devices() {
        assert_eq!(
            validate_serial_line(" /dev/cu.usbserial-A ", true),
            Ok("/dev/cu.usbserial-A"),
        );
        assert!(validate_serial_line("/dev/tty.usbserial-A", true).is_err());
        // PTY-backed virtual ports have no dial-in twin to prefer.
        assert_eq!(validate_serial_line("/dev/ttys004", true), Ok("/dev/ttys004"));
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
}

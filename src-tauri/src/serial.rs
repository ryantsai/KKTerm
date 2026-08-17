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
        .filter(|path| !macos || path.starts_with("/dev/cu."))
        .collect();
    ports.sort();
    ports.dedup();
    ports
}

pub fn start_native_terminal(
    app: AppHandle,
    request: NativeSerialTerminalRequest,
) -> Result<NativeSerialTerminal, String> {
    let line = request.line.trim();
    if line.is_empty() {
        return Err("serial line is required".to_string());
    }
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
                    emit_terminal_output(
                        &app,
                        &request.session_id,
                        format!("\r\n[serial read error: {error}]\r\n"),
                    );
                    break;
                }
            }
        }
    });

    Ok(NativeSerialTerminal {
        writer: port,
        closed,
    })
}

#[cfg(test)]
mod tests {
    use super::normalize_available_serial_ports;

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

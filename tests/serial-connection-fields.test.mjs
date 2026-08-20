import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const serialTransport = await readFile(new URL("../src-tauri/src/serial.rs", import.meta.url), "utf8");
const terminalWorkspace = await readFile(
  new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
  "utf8",
);
const connectionSidebar = await readFile(
  new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
  "utf8",
);

const fieldsSource = await readFile(
  new URL("../src/modules/workspace/connections/connection-dialog/SerialConnectionFields.tsx", import.meta.url),
  "utf8",
);
const connectionsCss = await readFile(
  new URL("../src/modules/workspace/connections/connections.css", import.meta.url),
  "utf8",
);
const logging = await readFile(new URL("../src-tauri/src/logging.rs", import.meta.url), "utf8");

test("Serial speed keeps the requested common baud suggestions", () => {
  assert.match(
    fieldsSource,
    /COMMON_SERIAL_SPEEDS\s*=\s*\[9600,\s*19200,\s*38400,\s*115200\]/,
  );
  assert.match(fieldsSource, /COMMON_SERIAL_SPEEDS\.map\(\(value\)/);
});

test("Serial speed remains an editable positive integer input", () => {
  assert.match(fieldsSource, /name="serialSpeed"[\s\S]*?value=\{speed\}/);
  assert.match(fieldsSource, /name="serialSpeed"[\s\S]*?min="1"[\s\S]*?step="1"/);
  assert.match(fieldsSource, /name="serialSpeed"[\s\S]*?onChange=\{\(event\) => setSpeed/);
  assert.match(connectionsCss, /\.serial-combobox:has|\.serial-combobox\s*\{/);
});

test("Serial speed hides the native stepper that would fight the chevron", () => {
  assert.match(connectionsCss, /\.serial-combobox > input::-webkit-inner-spin-button/);
});

test("A Serial reader that stops signals the Session end like Telnet and SSH", () => {
  // Without this the Pane keeps reporting a live Session after the adapter goes
  // away: keystrokes vanish and no reconnect is offered (issue #745).
  assert.match(serialTransport, /emit_terminal_session_ended\(&app, &request\.session_id\)/);
});

test("macOS rejects only the dial-in twin, not every non-callout path", () => {
  assert.match(serialTransport, /line\.starts_with\(MACOS_SERIAL_DIAL_IN_PREFIX\)/);
  assert.doesNotMatch(serialTransport, /!line\.starts_with\(MACOS_SERIAL_CALLOUT_PREFIX\)/);
});

test("Serial Panes and Connections can reconnect in place", () => {
  assert.match(
    terminalWorkspace,
    /isReconnectableTerminal =[\s\S]{0,200}?pane\.connection\?\.type === "serial"/,
  );
  assert.match(
    connectionSidebar,
    /handleTreeMenuReconnectConnection[\s\S]{0,400}?menu\.connection\.type !== "serial"/,
  );
});

test("A new Serial Connection is not pre-filled with a built-in non-device port", () => {
  // macOS publishes /dev/cu.Bluetooth-Incoming-Port and /dev/cu.debug-console with
  // no adapter attached, and they sort ahead of every real one. Picking detected[0]
  // aimed every new Connection at a line that opens fine and never speaks (#745).
  assert.match(fieldsSource, /NON_DEVICE_SERIAL_PORT_PATTERNS\s*=\s*\[\/bluetooth\/i/);
  assert.match(fieldsSource, /const preferred = preferredSerialPort\(detected\)/);
  assert.doesNotMatch(fieldsSource, /prefill && detected\[0\]/);
});

test("Serial keeps its own advanced-debugging channel like every other transport", () => {
  // The reporter enabled advanced debugging and the collected Logs folder had a
  // file for ui/ssh/telnet/sftp/rdp but none for serial, so the stuck Session
  // left no evidence at all (#745).
  assert.match(logging, /pub fn serial_debug\(event: &str, payload: &Value\)/);
  assert.match(logging, /\.join\("serial\.debug\.log"\)/);
  // The marker list is what creates the file, so an unlisted channel stays empty.
  assert.match(logging, /serial_debug_log_path_for\(runtime_log_path\),[\s\S]{0,8}\];/);
});

test("A Serial Pane reports the line settings the OS actually applied", () => {
  // Mojibake in a serial Pane is almost always a speed/framing mismatch, and the
  // banner is the only place the applied speed is visible to the user.
  assert.match(serialTransport, /\[serial \{line\} \{\} flow=\{\}\]/);
  assert.match(serialTransport, /fn serial_framing_summary\(/);
});

test("A Serial reader survives a transient zero-byte read", () => {
  // serial2 polls for POLLIN but accepts any revents, so a POLLHUP blip returns
  // Ok(0); ending the thread on the first one killed the Pane for good (#745).
  assert.match(serialTransport, /SERIAL_EMPTY_READS_BEFORE_HANGUP/);
  assert.doesNotMatch(serialTransport, /Ok\(0\) => break/);
});

test("Serial drops the mojibake the speed switch leaves in the receive queue", () => {
  // macOS applies the termios struct at 9600 before the IOSSIOSPEED ioctl, so
  // anything arriving in that window is sampled at the wrong rate (#745).
  assert.match(serialTransport, /port\.discard_input_buffer\(\)/);
});

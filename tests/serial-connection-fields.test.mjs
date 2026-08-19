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

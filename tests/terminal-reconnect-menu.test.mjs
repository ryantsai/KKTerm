import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [terminalSource, sidebarSource, sidebarStateSource, sessionsSource, sshSource, telnetSource] =
  await Promise.all([
    readFile(
      new URL(
        "../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/modules/workspace/connections/connectionSidebarState.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../src-tauri/src/sessions.rs", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/ssh.rs", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/telnet.rs", import.meta.url), "utf8"),
  ]);

test("SSH and Telnet hamburger menus lead with Close Connection or Reconnect", () => {
  const actionsMenu = terminalSource.match(
    /className="terminal-menu terminal-actions-menu terminal-actions-menu-portal"[\s\S]*?document\.body,/,
  )?.[0] ?? "";

  assert.ok(actionsMenu, "terminal actions menu should be discoverable");
  assert.match(actionsMenu, /isReconnectableTerminal && terminalConnectionState !== "connecting"/);
  assert.match(actionsMenu, /terminalConnectionState === "disconnected"[\s\S]*?<RefreshCw size=\{13\}/);
  assert.match(actionsMenu, /"connections\.reconnect"[\s\S]*?: "connections\.closeConnection"/);
  assert.ok(
    actionsMenu.indexOf("isReconnectableTerminal") < actionsMenu.indexOf("isSshPane"),
    "the connection action must be the first hamburger menu item",
  );
});

test("disconnected open SSH and Telnet Connections expose Reconnect in the native tree menu", () => {
  assert.match(
    sidebarSource,
    /const hasOpenTerminalPane =[\s\S]*?menu\.connection\.type === "ssh"[\s\S]*?menu\.connection\.type === "telnet"[\s\S]*?tab\.panes\.some/,
  );
  assert.match(
    sidebarSource,
    /else if \(hasOpenTerminalPane\) \{[\s\S]*?label: t\("connections\.reconnect"\)[\s\S]*?handleTreeMenuReconnectConnection/,
  );
  assert.match(sidebarStateSource, /RECONNECT_TERMINAL_CONNECTION_EVENT/);
  assert.match(terminalSource, /setReconnectGeneration\(\(generation\) => generation \+ 1\)/);
});

test("native SSH and Telnet workers report ended Sessions to the frontend", () => {
  assert.match(sessionsSource, /"terminal-session-ended"/);
  assert.match(sshSource, /emit_terminal_session_ended\(&app, &request\.session_id\)/);
  assert.match(telnetSource, /emit_terminal_session_ended\(&app, &reader_session_id\)/);
  assert.match(
    terminalSource,
    /listen<TerminalSessionEnded>\("terminal-session-ended"[\s\S]*?setTerminalConnectionState\("disconnected"\)/,
  );
});

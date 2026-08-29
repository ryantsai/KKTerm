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

test("reconnectable terminal menus always expose Pane-scoped Reconnect", () => {
  const actionsMenu = terminalSource.match(
    /className="terminal-menu terminal-actions-menu terminal-actions-menu-portal"[\s\S]*?document\.body,/,
  )?.[0] ?? "";

  assert.ok(actionsMenu, "terminal actions menu should be discoverable");
  assert.match(actionsMenu, /isReconnectableTerminal \? \(/);
  assert.doesNotMatch(actionsMenu, /terminalConnectionState === "disconnected"/);
  assert.match(actionsMenu, /<RefreshCw size=\{13\} \/>[\s\S]*?"connections\.reconnect"/);
  assert.doesNotMatch(actionsMenu, /"connections\.closeConnection"/);
  assert.ok(
    actionsMenu.indexOf("isReconnectableTerminal") < actionsMenu.indexOf("isSshPane"),
    "Reconnect must be the first hamburger menu item when it is available",
  );
});

test("disconnected terminal Panes promote Reconnect to a visible toolbar button", () => {
  assert.match(
    terminalSource,
    /isReconnectableTerminal && terminalConnectionState === "disconnected" \? \([\s\S]*?aria-label=\{t\("connections\.reconnect"\)\}[\s\S]*?setReconnectGeneration\(\(generation\) => generation \+ 1\)/,
  );
});

test("the configurable reconnect shortcut is Pane-scoped and remains safe for local shells", () => {
  assert.match(
    terminalSource,
    /case "reconnectActiveSession":[\s\S]*?if \(!isReconnectableTerminal\) \{[\s\S]*?return true;[\s\S]*?setReconnectGeneration\(\(generation\) => generation \+ 1\)/,
  );
});

test("open SSH, Telnet, and Serial Connections expose Reconnect in the native tree menu", () => {
  assert.match(
    sidebarSource,
    /const hasOpenTerminalPane =[\s\S]*?menu\.connection\.type === "ssh"[\s\S]*?menu\.connection\.type === "telnet"[\s\S]*?menu\.connection\.type === "serial"[\s\S]*?tab\.kind === "terminal"[\s\S]*?tab\.panes\.some/,
  );
  assert.match(
    sidebarSource,
    /if \(isConnected\) \{[\s\S]*?label: t\("connections\.closeConnection"\)[\s\S]*?\}\s*if \(hasOpenTerminalPane\) \{[\s\S]*?label: t\("connections\.reconnect"\)[\s\S]*?handleTreeMenuReconnectConnection/,
  );
  assert.match(sidebarStateSource, /RECONNECT_TERMINAL_CONNECTION_EVENT/);
  assert.match(terminalSource, /setReconnectGeneration\(\(generation\) => generation \+ 1\)/);
});

test("F5 reconnects the selected tree Connection without becoming a terminal shortcut", () => {
  const sidebarOpening = sidebarSource.match(
    /<aside[\s\S]*?className="connection-sidebar"[\s\S]*?>/,
  )?.[0] ?? "";
  const treeListOpening = sidebarSource.match(
    /<div\s+ref=\{treeListRef\}[\s\S]*?data-tree-drop-kind="root"[\s\S]*?>/,
  )?.[0] ?? "";

  assert.match(
    sidebarSource,
    /const isReconnect = event\.key === "F5";[\s\S]*?requestTerminalConnectionReconnect\(connection\.id\)/,
  );
  assert.match(
    sidebarSource,
    /const isReconnect = event\.key === "F5";[\s\S]*?if \(event\.defaultPrevented && !isReconnect\)/,
    "the shell reload guard marks F5 prevented before React sees it, so the focused Tree must still handle it",
  );
  assert.match(
    sidebarOpening,
    /onKeyDown=\{handleTreeKeyDown\}/,
    "F5 should bubble from any focused non-editable control in the Connection Tree pane",
  );
  assert.match(
    treeListOpening,
    /tabIndex=\{0\}/,
    "the blank Connection Tree list surface should be keyboard-focusable",
  );
  assert.match(
    sidebarSource,
    /if \(!isReconnect && !target\.closest\("\.tree-list"\)\)/,
    "rename and delete must remain scoped to the scrolling Tree",
  );
  assert.doesNotMatch(
    treeListOpening,
    /onKeyDown=/,
    "the inner list should not own a duplicate keyboard handler",
  );
});

test("native SSH and Telnet workers report ended Sessions to the frontend", () => {
  assert.match(sessionsSource, /"terminal-session-ended"/);
  assert.match(sshSource, /emit_terminal_session_ended\(&app, &request\.session_id\)/);
  assert.match(telnetSource, /emit_terminal_session_ended\(&app, &reader_session_id\)/);
  assert.match(
    terminalSource,
    /listen<TerminalSessionEnded>\("terminal-session-ended"[\s\S]*?updateTerminalConnectionState\("disconnected"\)/,
  );
});

test("input reconnects an authoritatively disconnected SSH Session once", () => {
  assert.match(
    terminalSource,
    /const terminalConnectionStateRef = useRef[\s\S]*?function updateTerminalConnectionState[\s\S]*?terminalConnectionStateRef\.current = state;[\s\S]*?setTerminalConnectionState\(state\)/,
    "the long-lived xterm input callback needs an imperative view of Session state",
  );
  assert.match(
    terminalSource,
    /const dataDisposable = terminal\.onData\(\(data\) => \{[\s\S]*?connection\.type === "ssh"[\s\S]*?terminalConnectionStateRef\.current === "disconnected"[\s\S]*?updateTerminalConnectionState\("connecting"\)[\s\S]*?setReconnectGeneration\(\(generation\) => generation \+ 1\)[\s\S]*?return;/,
    "the first SSH input after an authoritative disconnect should reconnect instead of writing to the dead Session",
  );
});

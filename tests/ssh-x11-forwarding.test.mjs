import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("managed X server enables SSH X11 forwarding before shell startup", async () => {
  const sshSource = await readFile(new URL("../src-tauri/src/ssh.rs", import.meta.url), "utf8");
  const sessionsSource = await readFile(
    new URL("../src-tauri/src/sessions.rs", import.meta.url),
    "utf8",
  );

  assert.match(sshSource, /pub x11_forwarding: Option<NativeSshX11Forwarding>/);
  assert.match(sshSource, /server_channel_open_x11/);
  assert.match(sshSource, /TcpStream::connect\(\("127\.0\.0\.1", x11_port\(display\)\)\)/);

  const requestOrder = sshSource.indexOf(".request_x11(");
  const shellOrder = sshSource.indexOf(".request_shell(");
  assert.ok(requestOrder > -1, "SSH terminal startup should request X11 forwarding");
  assert.ok(shellOrder > -1, "SSH terminal startup should request a shell");
  assert.ok(requestOrder < shellOrder, "X11 forwarding should be requested before shell startup");

  assert.match(sessionsSource, /NativeSshX11Forwarding/);
  assert.match(sessionsSource, /x11_forwarding:\s+managed_x_server_display\s+\.map/s);
});

test("remote X11 forwarding rejection keeps SSH shell open and reports rejected status", async () => {
  const sshSource = await readFile(new URL("../src-tauri/src/ssh.rs", import.meta.url), "utf8");
  const sessionsSource = await readFile(
    new URL("../src-tauri/src/sessions.rs", import.meta.url),
    "utf8",
  );
  const tauriSource = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
  const terminalSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    sshSource,
    /pub enum NativeSshX11ForwardingStatus \{\s*Enabled,\s*Rejected,\s*\}/s,
    "native SSH startup should expose whether requested X11 forwarding was accepted or rejected",
  );
  assert.match(
    sshSource,
    /Some\(request_x11_forwarding\(&mut channel, &mut startup_messages\)\.await\?\)/,
    "startup should wait for the actual server reply before reporting X11 status",
  );
  assert.match(
    sshSource,
    /Some\(ChannelMsg::Failure\) => return Ok\(NativeSshX11ForwardingStatus::Rejected\)/,
    "X11 request rejection should be reported as rejected",
  );
  assert.match(
    sessionsSource,
    /let x11_forwarding_status = session\.x11_forwarding_status\(\);[\s\S]*?x11_forwarding_status,/s,
    "session startup result should carry the native SSH X11 forwarding status",
  );
  assert.match(
    tauriSource,
    /x11ForwardingStatus\?: "enabled" \| "rejected";/,
    "frontend command type should expose X11 forwarding status",
  );
  assert.match(
    terminalSource,
    /startupState\.started\(result, x11ForwardingStatus\)/,
    "frontend should store rejected X11 status from startup result for the Pane toolbar",
  );
  assert.match(sshSource, /app\.emit\("terminal-session-ready", NativeSshTerminalReady/);
  assert.match(terminalSource, /listen<TerminalSessionStarted>\("terminal-session-ready"/);
  assert.match(terminalSource, /readyListener\.then\(\(unlisten\) => unlisten\(\)\)/);
});

test("SSH terminal toolbar shows separate X server forwarding state", async () => {
  const terminalSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const terminalStyles = await readFile(
    new URL("../src/modules/workspace/connections/terminal/terminal.css", import.meta.url),
    "utf8",
  );

  assert.match(
    terminalSource,
    /const x11ForwardingStatus = pane\.x11ForwardingStatus \?\? \(\s*pane\.connection\?\.type === "ssh" && sshSettings\.managedXServerEnabled \? "enabled" : "disabled"\s*\);/s,
    "the toolbar indicator should snapshot whether the SSH Session started with X11 forwarding enabled",
  );
  assert.match(
    terminalSource,
    /<XServerToolbarIndicator status=\{x11ForwardingStatus\} \/>/,
    "the SSH toolbar should render X11 forwarding state outside the tmux tag",
  );
  assert.match(
    terminalSource,
    /<span>\{tagLabel\}<\/span>/,
    "the tmux session label should not own the X11 indicator",
  );
  assert.match(
    terminalStyles,
    /\.tmux-x11-button\.disabled\s*\{[^}]*color:\s*#7f8a98;[^}]*opacity:\s*0\.45;/s,
    "disabled X11 forwarding should render as dim grey",
  );
  assert.match(
    terminalStyles,
    /\.tmux-x11-button\.enabled\s*\{[^}]*color:\s*#5ee787;[^}]*background:\s*rgba\(94,\s*231,\s*135,\s*0\.08\);/s,
    "enabled X11 forwarding should render as a subtle green button",
  );
  assert.match(
    terminalStyles,
    /\.tmux-x11-button\.rejected\s*\{[^}]*color:\s*#ff6b6b;[^}]*background:\s*rgba\(255,\s*107,\s*107,\s*0\.08\);/s,
    "rejected X11 forwarding should render as a subtle red button",
  );
});

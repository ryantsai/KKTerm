# 06 — SSH and tmux

## AI grep hints

- Keys: `terminal.verifyingHostKey`, `terminal.sshHostKeyChanged`, `terminal.sshHostKeyChangedDetail`, `terminal.sshHostKeyChangeDetail`, `terminal.trustHostKey`, `terminal.hostKeyNotTrusted`, `settings.autoTrustNewHostKeys`, `settings.autoTrustNewHostKeysHint`, `terminal.selectKeyFile`, `terminal.sshContextUnavailable`, `terminal.showTmux`, `terminal.editTmuxSession`, `terminal.tmuxSessionName`, `terminal.tmuxSessionNameRequired`, `terminal.tmuxSessionNameInvalid`, `terminal.tmuxSessionRenamed`, `terminal.tmuxSessions`, `terminal.refreshTmux`, `terminal.noTmuxSessions`, `terminal.attached`, `terminal.detached`, `terminal.detachTmux`, `terminal.closeTmux`, `terminal.openInPane`, `terminal.openLeft`, `terminal.openRight`, `terminal.openAbove`, `terminal.openBelow`, `terminal.mouseOn`, `terminal.mouseOff`, `terminal.sshPortRedirect`, `terminal.sshPortForwardingTitle`, `terminal.addForward`, `terminal.localListener`, `terminal.remoteListener`, `terminal.destination`, `terminal.forwardTo`, `terminal.bindAddress`, `terminal.listenPort`, `terminal.socksPort`, `terminal.runningForwards`, `terminal.noSshForwards`, `terminal.enableForwarding`, `terminal.disabled`, `terminal.sshPortForwardOpened`, `settings.xServer`, `settings.xServerManaged`, `settings.xServerLaunch`
- Topics: SSH host key trust, tmux session list, attach / detach / rename tmux, Child Connection Tab tmux resume, SSH local port forward for remote loopback services, SOCKS proxy troubleshooting, managed VcXsrv launch for local X11 windows, tutorial targets `terminal.tmuxSessions`, `terminal.sshPortRedirect`
- Synonyms: "trust this host", "auto accept fingerprint", "skip host key confirmation", "trust on first use", "TOFU", "key fingerprint changed", "MITM warning", "tmux session", "screen", "child tmux tab", "saved tmux tab", "port forward", "tunnel", "SOCKS", "proxy", "early eof", "Tinyproxy", "PuTTY", "X11", "X forwarding", "X server", "VcXsrv", "psmux", "native Windows tmux", "local session multiplexer", "PowerShell sessions"
- psmux keys: `connections.usePsmux`, `installer.psmux.installTitle`, `installer.psmux.installPrompt`, `installer.psmux.installing`, `terminal.showPsmux`, `terminal.psmuxSessions`. Connection field `usePsmuxSessions`; backend column `use_psmux_sessions`; Tauri commands `list_psmux_sessions`, `close_psmux_session`, `rename_psmux_session`, `set_psmux_mouse`.

## Host key trust

When connecting to an SSH host, the user sees `terminal.verifyingHostKey`. Host-key verification runs before authentication regardless of the auth method (password, key file, or agent).

For a host that has never been trusted, KKTerm shows an app-owned dialog:

- Trust action title: `terminal.trustHostKey`
- Untrusted state status: `terminal.hostKeyNotTrusted`

`settings.autoTrustNewHostKeys` (Settings → SSH, hint `settings.autoTrustNewHostKeysHint`, on by default) skips this first-connection dialog: the never-before-seen key is recorded automatically (trust-on-first-use) and the connection proceeds. The changed-key warning below is deliberately NOT affected by this option — a key that no longer matches a trusted host always prompts, because that is the MITM signal.

If the host key no longer matches a previously trusted key, KKTerm shows a stronger warning dialog instead of failing outright:

- Title: `terminal.replaceChangedHostKeyTitle`
- Body: `terminal.replaceChangedHostKeyWarning`

Confirming this dialog replaces the stored trusted key (the conflicting entry in KKTerm's `ssh_known_hosts` file is removed and the new key is learned); cancelling aborts with `terminal.hostKeyNotTrusted`. This is the fallback path for legitimate key rotation (server reinstall, rotated host keys). `terminal.sshHostKeyChanged`, `terminal.sshHostKeyChangedDetail`, and `terminal.sshHostKeyChangeDetail` remain for descriptive messaging.

This is not a `window.confirm`. Users explicitly approve the new key; the trusted key set is persisted with the Connection's metadata.

`terminal.selectKeyFile` is used by the keyfile picker when authenticating with a private key file. `terminal.sshContextUnavailable` is shown when the SSH transport cannot be reached (rare; surface to user as transport error, not a bug to silently retry).

Add/Edit Connection places `connections.keyPassphraseOptional` directly below the private-key path. A value is stored as a per-Connection `connectionPassphrase` secret in the configured secret store, never in the Connection row or plaintext settings data. Leaving the field blank while editing preserves an existing passphrase. When an encrypted key has no stored passphrase, or the stored passphrase cannot decrypt it, the terminal prompts for `SSH key passphrase:` interactively before authentication. This fallback applies to terminal Sessions; non-interactive fresh connections such as SFTP and one-shot tmux/IT Ops commands require the saved passphrase. An entered passphrase does not prevent an unencrypted key from loading; it is ignored for that key.

## Old protocol compatibility

`settings.sshOldProtocols` controls the global **Legacy Protocols** default and is off by default. `connections.sshOldProtocols` is the matching single-switch override for one SSH Connection. Enabling either switch appends the complete supported set of SHA-1-era key-exchange algorithms, the `aes256-cbc`, `aes192-cbc`, `aes128-cbc`, and `3des-cbc` ciphers, and the `hmac-sha1` MAC after the modern algorithms; individual legacy algorithms cannot be selected. Enable it only for trusted older hosts that cannot negotiate the modern default set.

The Add SSH Connection dialog's footer-left `connections.importSshConfig` action imports the platform default SSH config (`%USERPROFILE%\.ssh\config` on Windows, `~/.ssh/config` on macOS/Linux) when it exists. If the default file is absent, KKTerm opens a file picker. The import applies the first importable concrete `Host` alias to the dialog. Exact, `*`, `?`, and negated (`!`) Host patterns contribute supported `HostName`, `User`, `Port`, `IdentityFile`, and `ProxyJump` values using OpenSSH's first-obtained-value-wins order; wildcard-only patterns do not become Connections. Put broad `Host *` defaults after specific blocks when those blocks must override them. Unsupported directives are reported with their source line.

## Idle behaviour

A live SSH Session has **no app-side idle timeout**. Quiet and unfocused Sessions stay connected while the peer remains reachable. After 30 seconds without an inbound SSH packet, KKTerm sends a reply-requested keepalive; either success or failure proves the peer is alive. Four further intervals without any inbound SSH packet end the dead Session so a blackholed connection cannot keep swallowing input while shown as connected.

After KKTerm has authoritatively marked an SSH Session disconnected, the first keyboard, IME, or paste input in that terminal Pane is consumed and starts a reconnect. Further input cannot start another reconnect while that attempt is in progress; the visible Reconnect action remains available for an explicit retry.

For troubleshooting, enable `settings.advancedDebugging`, reproduce the disconnect without closing KKTerm, then use `settings.openLogFolder` and inspect `ssh.debug.log`. The `connection.start` record contains the KKTerm version, SSH client identification, effective keepalive interval, and miss limit. A transport end records `connection.disconnected.error` with a stable `errorKind` such as `keepalive_timeout`, `io`, or `disconnect`, plus the original `russh` error text. The log omits passwords, passphrases, typed input, and terminal contents, but can contain hostnames, usernames, proxy endpoints, and Session ids, so review it before sharing.

For tmux-enabled SSH Sessions, an unexpected channel close may silently attempt a small bounded reattach to the same Pane tmux id. New Pane tmux ids are drawn directly from the active locale's `ai.tmuxSessionLabels` pool, so the actual remote tmux session name is localized. The Pane tmux id lives in frontend workspace storage; it is not durable Connection model state.

## SOCKS proxy troubleshooting

The global app proxy (Settings → Proxy, `settings.proxy`) and per-Connection SOCKS overrides expect a SOCKS5 server endpoint, such as `host:port` or `username:password@host:port`. They are not HTTP proxy URLs. A global manual SOCKS5 proxy applies to SSH terminals, tmux, SFTP, key transfer, and Telnet when no per-Connection override is set and the Connection does not use ProxyJump. Some proxy packages, including Tinyproxy, primarily expose an HTTP/HTTPS CONNECT proxy listener and can use SOCKS as an upstream target; that listener is not the same thing as the SOCKS5 endpoint KKTerm dials.

When `ssh.debug.log` shows `connection.socks.connect_ok`, followed later by `connection.disconnected.error` with `error` set to `early eof`, the SOCKS handshake succeeded and the underlying SSH byte stream was closed without a clean SSH disconnect. If PuTTY or OpenSSH reproduces the same disconnect through the same SOCKS server, treat the proxy or network path as the failing component rather than adding KKTerm-specific reconnect workarounds. Check the proxy's listener type, ACLs, upstream rules, timeout/idle settings, connection lifetime limits, and proxy-side logs.

KKTerm keeps tmux recovery intentionally bounded: an existing tmux Session may reattach after a short-lived channel drop, but persistent proxy-side closes should remain visible in the Pane and in `ssh.debug.log`.

## tmux sessions

SSH Connections may opt into tmux. When tmux is enabled, opening the Connection starts (or attaches to) a named tmux session on the remote host. If `tmux` is not installed on the remote, the Pane silently falls back to the normal shell — no error dialog — and the Pane toolbar stops showing tmux controls for that live shell.

When a tmux-enabled SSH Connection is opened through the Connection Tree `workspace.newTab` path (`connections.newTabShortcut`), KKTerm first asks the remote for tmux sessions and picks the newest unattached session by `session_created`, excluding tmux Session ids that are already present in current workspace Panes. If no eligible session is available, or if the tmux listing fails, the new Tab falls through to the normal new-Pane tmux naming path.

When Child Connection Tabs are enabled through `settings.hideTopTabButtons`, a tmux-enabled SSH child uses its tmux session id as the default Child Connection Tab name. The child stores that tmux session id so reopening the child row after app launch attaches to the same remote tmux session instead of allocating a new one. This child record is still frontend Workspace state; the saved SSH Connection stores only the tmux launch preference.

### Tmux session list popover

Opened from the Pane toolbar `terminal.showTmux`.

Tutorial target: `terminal.tmuxSessions`.

- Header: `terminal.tmuxSessions`
- Refresh: `terminal.refreshTmux`
- Loading state: `terminal.loading`
- Empty: `terminal.noTmuxSessions`
- Each row: tmux session name, status `terminal.attached` / `terminal.detached`, tmux-reported last attached time when available, tmux-reported session path when available, and an open action.

Open actions for an unattached session: `terminal.openInPane`, and split-spawn variants `terminal.openLeft`, `terminal.openRight`, `terminal.openAbove`, `terminal.openBelow`.

Per-row actions:

- `terminal.editTmuxSession` — rename. Dialog field `terminal.tmuxSessionName`. Validation: empty (`terminal.tmuxSessionNameRequired`), invalid characters (`terminal.tmuxSessionNameInvalid`). Success status: `terminal.tmuxSessionRenamed`.
- `terminal.detachTmux` — detach the current Pane from the tmux session without ending it.
- `terminal.closeTmux` — terminate the tmux session.

### Tmux mouse toggle

`terminal.mouseOn` / `terminal.mouseOff` enables or disables tmux mouse mode in the attached session.
When tmux mouse mode is off, wheel input over the Pane is kept in KKTerm's terminal scrollback path instead of being sent to the remote shell as cursor-key input.

## Local psmux sessions

[psmux](https://github.com/psmux/psmux) is the native Windows "tmux for PowerShell". KKTerm offers it as the local-shell counterpart to SSH tmux: a per-Connection opt-in that gives a local PowerShell terminal Pane the same toolbar session list, with the same options and the same localized session-name pool (`ai.tmuxSessionLabels`).

### Enabling the toggle

In the local Connection dialog, a **`connections.usePsmux`** ("Use psmux session management") toggle appears **only when the selected shell is PowerShell or PowerShell 7 (pwsh)** — not for Command Prompt, WSL, or Git Bash. It **defaults off**.

Turning it on checks whether psmux is installed (`local_shell_available` for `psmux.exe`):

- If psmux is already installed, the toggle simply turns on.
- If psmux is missing, KKTerm prompts (`installer.psmux.installPrompt` / `installer.psmux.installTitle`) and, on accept, runs the Install Helper's `psmux` recipe (`installer.psmux.installing`). The toggle stays on only when psmux ends up available; declining or a failed install reverts it to off.

The preference persists as the local-only `usePsmuxSessions` Connection flag (backend column `use_psmux_sessions`, normalized off for any non-local Connection). It is mutually exclusive with SSH tmux by Connection type — a Pane is either SSH-tmux or local-psmux, never both, and both reuse the same `pane.tmuxSessionId` slot and name pool.

### Launch and session list

When enabled, opening the Connection launches the chosen PowerShell shell wrapped as `psmux new-session -A -s <session-id> -- <shell>` (attach-or-create), and the Pane toolbar shows a **`terminal.showPsmux`** session popover (header `terminal.psmuxSessions`) mirroring the tmux popover: list / refresh, open-in-pane and split variants, rename (`terminal.editTmuxSession`), close (`terminal.closeTmux`), and the mouse toggle. psmux is CLI-compatible with tmux, so the same `list-sessions -F` format string and `kill-session` / `rename-session` / `set-option mouse` commands are reused — but they run as one-shot local `psmux.exe` processes (`list_psmux_sessions`, `close_psmux_session`, `rename_psmux_session`, `set_psmux_mouse`) instead of over an SSH channel.

If psmux is not installed when the Pane launches, the Pane silently falls back to the plain PowerShell shell — no error dialog — matching the tmux-unavailable behavior.

## SSH port forwarding

For SSH port forwarding:

- Open `terminal.sshPortRedirect` from the terminal action menu. Once the Connection has one or more enabled mappings, the Pane toolbar also shows a green tunnel button beside `terminal.startRecording`; clicking it opens the same centered dialog.
- The centered dialog title is `terminal.sshPortForwardingTitle`.
- The dialog has Local (`-L`), Remote (`-R`), and Dynamic (`-D`) mode tabs. Counts on the tabs show enabled mappings for the saved SSH Connection.
- Bind address, listener port, destination host, and destination port remain editable text fields with dropdown suggestions. Local and Dynamic bind suggestions use this PC's detected interface addresses; Remote bind suggestions use addresses detected on the SSH server. A loopback destination in Local mode suggests listening ports discovered on the remote SSH host. In Remote mode, the local destination port suggests TCP listeners compatible with the selected local host, including same-family wildcard listeners.
- Mappings are non-secret per-Connection settings. Child Connection Tabs, split Panes, additional Tabs, and Dashboard-spawned surfaces share the parent SSH Connection's mapping list instead of owning independent forwarding settings.
- Starting an already-running mapping reuses that mapping's stable forward id, so opening additional Child Connection Tabs, Panes, or Tabs for the same parent Connection does not recreate duplicate tunnels. New forwards reuse the authenticated native SSH Session for the Pane that opened the dialog, including Sessions authenticated by entering a password interactively.
- Opening an SSH Connection automatically starts all of its saved enabled mappings after the native SSH Session connects. A mapping failure does not close the SSH Session or prevent the remaining mappings from starting; `terminal.sshPortForwardStartupFailed` reports the failure in the Status Bar.
- Validation, start, persistence, enable/disable, delete, and endpoint-opening errors from the forwarding dialog appear through the shared bottom Status Bar notice instead of inline dialog text.
- Each saved mapping has an enabled switch immediately before delete. New mappings start enabled; switching one off closes its live tunnel but preserves the mapping so it can be enabled again later.
- Enabled Local and Dynamic mappings cannot use overlapping local listeners. An exact bind address and port cannot be added twice, and a wildcard listener such as `0.0.0.0:8080` also conflicts with a specific IPv4 listener on port 8080. Remote listeners are checked by the SSH server instead because they bind on the remote host.
- Local (`-L`) forwards open a listener on this PC and send connections to the configured destination through SSH. The enabled Local listener text in the running list is clickable and opens the forwarded target in the external browser. Ports 443 and 8443 use HTTPS; other ports use HTTP. A wildcard `0.0.0.0` listener opens through `127.0.0.1`.
- Remote (`-R`) forwards ask the SSH server to open the configured remote listener and bridge incoming connections to the configured destination on this PC. The dialog's left fields and established-mapping rows identify the local destination; the right side identifies the server listener. Enabled non-loopback server listeners are clickable. Wildcard listeners open through the SSH Connection host, ports 443 and 8443 use HTTPS, and remote loopback listeners remain non-clickable. New Remote mappings default the server listener to `0.0.0.0`, which exposes it on all remote IPv4 interfaces when the SSH server's forwarding and gateway policy permits it. In Remote mode, the footer reminder `terminal.sshRemoteGatewayPortsHint` notes that wildcard listeners require `GatewayPorts clientspecified`; `GatewayPorts no` restricts them to loopback.
- Dynamic (`-D`) forwards run a local unauthenticated SOCKS5 CONNECT proxy over the existing SSH Session. Configure applications to use the displayed listener as a SOCKS5 proxy; DNS names supplied by the application are resolved through the SSH destination side.
- In Local and Remote modes, distinct non-loopback destination hosts appear as small connected nodes beyond the relaying machine. Satellite nodes show only the host, multiple mappings to the same host share one node, and dense sets collapse behind a `+N` node. The main PC and server nodes omit endpoint captions because the editable draft may not represent an established mapping.
- The diagram's Listening chip uses the shared green active-status color in every forwarding mode.
- Deleting the last enabled mapping removes the green toolbar tunnel button from open SSH Panes after the Connection metadata refreshes.

Tutorial target: `terminal.sshPortRedirect`.

The forwarding runtime uses native SSH channels and does not create a second terminal Pane, tmux shell, or SSH login.

## Local X server launcher

Settings - SSH exposes `settings.xServer` for a managed VcXsrv launcher. When `settings.xServerManaged` is enabled, KKTerm detects whether `vcxsrv.exe` is already running the first time it needs the local X server during an app run, then reuses that known-running state for later SSH Sessions instead of probing process status on each open. If VcXsrv is not already running, KKTerm starts it with the configured display number and launch arguments. The Status Bar X indicator reflects that managed X server setting, not live process polling. `settings.xServerLaunch` saves the current SSH settings draft and launches VcXsrv immediately so users can verify the local X server outside an SSH Session.

X11 forwarding is negotiated while a new native SSH Session starts, before the remote shell opens, and the X11 indicator reflects whether the server accepted or rejected that request. SSH Sessions that were already open before enabling or restarting VcXsrv need to be reconnected or opened again before remote X11 apps receive `DISPLAY`. If the Session attaches to an existing tmux pane, that pane's already-running shell may still have the old environment; open a new tmux pane/window or export the new `DISPLAY` inside that shell.

The launcher manages only the local Windows X server process. It does not create a durable Connection and does not store live process state in the Connection model.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("SSH toolbar SFTP popup exposes a runtime protocol selector", async () => {
  const [terminalSource, workspaceSource, stylesSource, manualSource] = await Promise.all([
    readFile(
      new URL("../src/modules/workspace/connections/terminal/SftpToolbarPopup.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/modules/workspace/connections/sftp/SftpWorkspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/modules/workspace/connections/sftp/sftp.css", import.meta.url), "utf8"),
    readFile(new URL("../docs/manual/07-sftp.md", import.meta.url), "utf8"),
  ]);

  assert.match(
    terminalSource,
    /protocolSourceConnection=\{browser.tab.connection\}/,
    "the popup should pass its SSH source Connection to the file browser surface",
  );
  assert.match(
    workspaceSource,
    /const SSH_FILE_BROWSER_PROTOCOL_STORAGE_KEY = "kkterm\.sshFileBrowserProtocol\.v1";/,
    "the last successful SSH-popup protocol should be remembered in localStorage",
  );
  assert.match(
    workspaceSource,
    /className="sftp-protocol-change"[\s\S]*aria-label=\{t\("sftp\.protocolSelectorAria"\)\}/,
    "the titlebar should render an accessible protocol change button",
  );
  assert.match(
    workspaceSource,
    /sshFileBrowserProtocolOptions\(t\)\.map[\s\S]*role="menuitemradio"/,
    "the protocol change button should open an app-owned protocol menu",
  );
  assert.match(
    workspaceSource,
    /value: "ftpsExplicit" as const[\s\S]*value: "ftpsImplicit" as const[\s\S]*value: "ftp" as const/,
    "the menu should offer explicit FTPS, implicit FTPS, and plain FTP",
  );
  assert.match(
    workspaceSource,
    /function defaultPortForSshFileBrowserProtocol[\s\S]*protocol === "sftp"[\s\S]*\?\? 22[\s\S]*protocol === "ftpsExplicit"[\s\S]*return 21[\s\S]*protocol === "ftpsImplicit"[\s\S]*return 990[\s\S]*return 21/,
    "the protocol menu should use standard SFTP/FTPS/FTP default ports",
  );
  assert.match(
    workspaceSource,
    /className="sftp-protocol-port-input"[\s\S]*value=\{sshFileBrowserPortDraft\}[\s\S]*onBlur=\{commitProtocolPortDraft\}/,
    "the protocol menu should include an editable port field that commits on blur",
  );
  assert.match(
    workspaceSource,
    /writeStoredSshFileBrowserProtocol\(sourceConnection\.id, \{\s*protocol: sshFileBrowserProtocol,\s*port: sshFileBrowserPort,\s*\}\)/,
    "the selected protocol and port should only be saved after a successful browser session starts",
  );
  assert.match(
    workspaceSource,
    /setPlainFtpFallbackActive\(true\);[\s\S]*showStatusBarNotice\(t\("sftp\.ftpsFallbackStatus"\), \{ tone: "warning" \}\);[\s\S]*setSshFileBrowserProtocol\("ftp"\);/,
    "FTPS startup failures should fall back to plain FTP through the standard warning notice",
  );
  assert.match(
    workspaceSource,
    /className="sftp-title-warning"/,
    "plain FTP should surface a compact titlebar warning",
  );
  assert.match(
    workspaceSource,
    /className="sftp-title-warning"[\s\S]*className="sftp-conn-pill"[\s\S]*className="sftp-bar-close"/,
    "the connection status should sit in the right titlebar cluster immediately before the close button",
  );
  assert.match(
    stylesSource,
    /\.sftp-protocol-change\s*\{[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/,
    "the protocol change control should stay subtle enough for the title",
  );
  assert.match(
    manualSource,
    /titlebar change button \(`sftp\.protocolSelectorAria`\)[\s\S]*last successfully connected protocol/,
    "the shipped manual should document the runtime protocol selector and localStorage memory",
  );
  assert.match(
    manualSource,
    /protocol kind[\s\S]*subtle protocol change button \(`sftp\.protocolSelectorAria`\)[\s\S]*compact connection status/,
    "the shipped manual should document the titlebar control and status placement",
  );
  assert.match(
    manualSource,
    /default ports are SFTP 22, explicit FTPS 21, implicit FTPS 990, and plain FTP 21/,
    "the shipped manual should document the protocol menu's default ports",
  );
});

test("file browser password prompts pass transient passwords without saving them", async () => {
  const [workspaceSource, commandSource, sftpBackend, ftpBackend] = await Promise.all([
    readFile(
      new URL("../src/modules/workspace/connections/sftp/SftpWorkspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/lib/fileBrowserCommands.ts", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/sftp.rs", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/ftp.rs", import.meta.url), "utf8"),
  ]);

  assert.match(
    workspaceSource,
    /shouldPromptBeforeFileBrowserConnect\(connection, sourceConnection, sshFileBrowserProtocol\)/,
    "the password preflight should receive the active protocol so FTP can prompt even when the parent SSH Connection uses key auth",
  );
  assert.match(
    workspaceSource,
    /protocol !== "sftp"[\s\S]*credentialSource = connection/,
    "FTP and FTPS popup sessions should check their synthetic password credentials instead of the parent SSH auth method",
  );
  assert.match(
    workspaceSource,
    /<PasswordPromptDialog[\s\S]*onSubmit=\{\(password\) => completePasswordPrompt\(password\)\}/,
    "SftpWorkspace should show an app-owned password dialog for missing browser passwords",
  );
  assert.match(
    workspaceSource,
    /passwordPromptPromiseRef = useRef<Promise<string \| null> \| null>\(null\)/,
    "overlapping session startup attempts should share the currently open password prompt",
  );
  assert.match(
    workspaceSource,
    /if \(passwordPromptPromiseRef\.current\) \{[\s\S]*return passwordPromptPromiseRef\.current;/,
    "a second startup attempt should wait on the existing password prompt instead of treating it as canceled",
  );
  assert.match(
    workspaceSource,
    /passwordPromptPromiseRef\.current = null;[\s\S]*passwordPromptResolverRef\.current = null;/,
    "completing the password prompt should clear both the pending promise and resolver",
  );
  assert.match(
    workspaceSource,
    /effectiveBrowserKind === "ftp" && message !== t\("sftp\.passwordPromptCanceled"\)/,
    "canceling a password prompt should not stack an FTP connection-failed dialog over the prompt flow",
  );
  assert.match(
    workspaceSource,
    /result = await startSessionAt\(enteredPassword\)/,
    "the retry after a password prompt should use the entered password transiently",
  );
  assert.match(
    workspaceSource,
    /path: preferredRemoteDirectory,[\s\S]*password: sessionPassword,/,
    "session startup should pass the transient password alongside the preferred start directory",
  );
  assert.match(
    workspaceSource,
    /tab\.connection\?\.ftpOptions\?\.localPath\?\.trim\(\) \|\| undefined/,
    "standalone FTP/SFTP browser tabs should read the configured local start path",
  );
  assert.match(
    workspaceSource,
    /\(sourceConnection \? initialRemotePath : connection\.ftpOptions\?\.remotePath\)\?\.trim\(\) \|\| "\."/,
    "standalone FTP/SFTP browser tabs should read the configured remote start path",
  );
  assert.match(
    commandSource,
    /startSession: \(\{ sessionId, path, password \}\)[\s\S]*start_sftp_session[\s\S]*password,/,
    "SFTP command requests should include the transient password when provided",
  );
  assert.match(
    commandSource,
    /startSession: \(\{ sessionId, path, password \}\)[\s\S]*start_ftp_session[\s\S]*password,/,
    "FTP command requests should include the transient password when provided",
  );
  assert.match(
    sftpBackend,
    /pub password: Option<String>,[\s\S]*NativeSshAuth::Password[\s\S]*password: Some\(password\.to_string\(\)\)/,
    "the SFTP backend should accept a one-shot password before reading saved secrets",
  );
  assert.match(
    ftpBackend,
    /pub password: Option<String>,[\s\S]*Some\(password\) => password\.to_string\(\)/,
    "the FTP backend should accept a one-shot password before reading saved secrets",
  );
});

test("FTP startup errors use app dialogs instead of the transfer queue", async () => {
  const [workspaceSource, stylesSource, manualSource, enSource] = await Promise.all([
    readFile(
      new URL("../src/modules/workspace/connections/sftp/SftpWorkspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/modules/workspace/connections/sftp/sftp.css", import.meta.url), "utf8"),
    readFile(new URL("../docs/manual/07-sftp.md", import.meta.url), "utf8"),
    readFile(new URL("../src/i18n/locales/en.json", import.meta.url), "utf8"),
  ]);

  assert.match(
    workspaceSource,
    /setFtpNoticeDialog\(\{\s*title: t\("sftp\.ftpConnectionErrorTitle"[\s\S]*message,\s*\}\)/,
    "FTP startup failures should open an app-owned dialog with the backend error",
  );
  assert.doesNotMatch(
    workspaceSource,
    /plainFtpWarningBody/,
    "plain FTP warnings should stay as the titlebar chip, without a blocking dialog",
  );
  assert.match(
    workspaceSource,
    /<TransferArea[\s\S]*error=\{effectiveBrowserKind === "ftp" \? undefined : remoteError\}/,
    "FTP startup errors should no longer be rendered as transfer-queue errors",
  );
  assert.match(
    workspaceSource,
    /<FtpNoticeDialog[\s\S]*notice=\{ftpNoticeDialog\}[\s\S]*onClose=\{\(\) => setFtpNoticeDialog\(null\)\}/,
    "FTP notices should render through a shared app dialog",
  );
  assert.match(
    stylesSource,
    /\.sftp-ftp-notice-dialog\s*\{[\s\S]*gap:\s*12px;/,
    "the FTP notice dialog should use local SFTP dialog body styling",
  );
  assert.match(
    manualSource,
    /FTPS fallback uses the standard Status Bar warning notice[\s\S]*FTP connection errors open an app-owned dialog[\s\S]*Plain FTP keeps only the compact `sftp\.plainFtpWarning` titlebar chip/,
    "the manual should document FTPS fallback as a standard warning notice and plain FTP warnings as titlebar-only",
  );
  assert.match(
    enSource,
    /"ftpConnectionErrorTitle": "FTP connection failed"/,
    "the FTP error dialog title should exist in English",
  );
});

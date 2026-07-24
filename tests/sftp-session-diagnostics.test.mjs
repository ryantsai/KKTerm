import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("SFTP manager avoids global session-map lock during blocking operations", async () => {
  const source = await readFile(new URL("../src-tauri/src/sftp.rs", import.meta.url), "utf8");

  assert.match(
    source,
    /sessions:\s*Mutex<HashMap<String,\s*Arc<Mutex<SftpConnection>>>>/,
    "SFTP sessions should be individually locked instead of keeping one global map lock during I/O",
  );
  assert.match(
    source,
    /fn with_session<R>[\s\S]*?let session = self\.shared_session\(session_id\)\?;[\s\S]*?\.lock\(\)/,
    "SFTP operations should clone the session handle before locking the individual session",
  );
  assert.match(
    source,
    /fn shared_session[\s\S]*?\.get\(session_id\)[\s\S]*?\.cloned\(\)/,
    "shared_session should release the map lock after cloning the per-session handle",
  );
  assert.doesNotMatch(
    source,
    /\.get\(&request\.session_id\)[\s\S]{0,240}?\.block_on\(/,
    "SFTP request handlers must not call block_on while borrowing from the sessions map",
  );
});

test("SFTP uploads bound remote writes and clean up new partial files", async () => {
  const source = await readFile(new URL("../src-tauri/src/sftp.rs", import.meta.url), "utf8");

  assert.match(source, /const SFTP_TRANSFER_IO_TIMEOUT:\s*Duration = Duration::from_secs\(60\);/);
  assert.match(
    source,
    /with_sftp_transfer_io_timeout\(\s*"opening remote upload file"[\s\S]*?open_with_flags/,
    "remote file creation should be bounded so a server stall becomes a failed transfer",
  );
  assert.match(
    source,
    /with_sftp_transfer_io_timeout\(\s*"uploading remote file chunk"[\s\S]*?write_all/,
    "remote chunk writes should be bounded so progress cannot remain at 0% forever",
  );
  assert.match(
    source,
    /if let Err\(error\) = upload_result[\s\S]*?if !target\.existed[\s\S]*?remove_file/,
    "failed new uploads should remove the newly-created partial remote file",
  );
  assert.match(
    source,
    /"transfer\.upload\.partial_cleanup"/,
    "partial-upload cleanup should be visible in SFTP debug logs",
  );
});

test("SFTP disables russh compression and serializes acknowledged writes", async () => {
  const source = await readFile(new URL("../src-tauri/src/sftp.rs", import.meta.url), "utf8");

  assert.match(source, /const SFTP_MAX_CONCURRENT_WRITES:\s*usize = 1;/);
  assert.match(
    source,
    /SftpConfig\s*\{[\s\S]*?max_concurrent_writes:\s*SFTP_MAX_CONCURRENT_WRITES/,
    "SFTP must wait for each WRITE acknowledgement before issuing another write",
  );
  assert.match(
    source,
    /fn effective_sftp_ssh_compression\(_requested: Option<bool>\) -> bool[\s\S]*?\bfalse\b/,
    "the backend must force SFTP SSH compression off regardless of frontend settings",
  );
  assert.match(source, /"compressionRequested": requested_compression/);
  assert.match(source, /"compression": compression/);
});

test("SFTP cancellation wakes blocked I/O and reconnects before draining its queue", async () => {
  const [backend, frontend] = await Promise.all([
    readFile(new URL("../src-tauri/src/sftp.rs", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../src/modules/workspace/connections/sftp/SftpWorkspace.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(backend, /transfers:\s*Mutex<HashMap<String,\s*CancellationToken>>/);
  assert.match(backend, /tokio::select![\s\S]*?cancellation\.cancelled\(\)/);
  assert.match(backend, /SFTP_SESSION_INVALIDATED_MARKER/);
  assert.match(backend, /fn invalidate_session[\s\S]*?sessions\.remove\(session_id\)/);
  assert.match(frontend, /SFTP_SESSION_INVALIDATED_MARKER/);
  assert.match(frontend, /setSessionRestartKey\(\(current\) => current \+ 1\)/);
  assert.match(
    frontend,
    /status !== t\("sftp\.connected"\) \|\| !sessionIdRef\.current/,
    "queued transfers must pause until the replacement session is connected",
  );
});

test("SFTP debug logging has a dedicated target and docs", async () => {
  const [logging, architecture, settingsManual, sftpManual] = await Promise.all([
    readFile(new URL("../src-tauri/src/logging.rs", import.meta.url), "utf8"),
    readFile(new URL("../docs/ARCHITECTURE.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/manual/15-settings.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/manual/07-sftp.md", import.meta.url), "utf8"),
  ]);

  assert.match(logging, /pub fn sftp_debug\(event: &str, payload: &Value\)/);
  assert.match(logging, /\.join\("sftp\.debug\.log"\)/);
  assert.match(logging, /sftp_debug_log_path_for\(runtime_log_path\)/);
  assert.match(architecture, /`sftp\.debug\.log`/);
  assert.match(settingsManual, /`sftp\.debug\.log`/);
  assert.match(sftpManual, /## SFTP Debug Logging[\s\S]*`sftp\.debug\.log`/);
});

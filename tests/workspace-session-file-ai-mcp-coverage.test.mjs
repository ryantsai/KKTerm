import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const nativeTools = [
  "session_activate_tab",
  "session_open_file_browser",
  "session_open_file_viewer",
  "session_close_tab",
  "session_split_pane",
  "session_close_pane",
  "session_url_state",
  "session_url_navigate",
  "session_url_reload",
  "session_url_back",
  "session_url_forward",
  "session_file_browser_list",
  "session_file_browser_create_folder",
  "session_file_browser_rename",
  "session_file_browser_delete",
  "session_file_browser_properties",
  "session_file_browser_update_properties",
  "session_file_browser_read",
  "session_file_browser_write",
  "session_file_browser_upload",
  "session_file_browser_download",
  "session_file_browser_transfer_status",
  "session_file_browser_cancel_transfer",
];

const mcpTools = [
  "kkterm.workspace.sessions.activate_tab",
  "kkterm.workspace.sessions.dangerous.open_file_browser",
  "kkterm.workspace.sessions.open_file_viewer",
  "kkterm.workspace.sessions.dangerous.close_tab",
  "kkterm.workspace.sessions.dangerous.split_pane",
  "kkterm.workspace.sessions.dangerous.close_pane",
  "kkterm.workspace.sessions.url_state",
  "kkterm.workspace.sessions.dangerous.url_navigate",
  "kkterm.workspace.sessions.dangerous.url_reload",
  "kkterm.workspace.sessions.dangerous.url_back",
  "kkterm.workspace.sessions.dangerous.url_forward",
  "kkterm.workspace.file_browser.list",
  "kkterm.workspace.file_browser.properties",
  "kkterm.workspace.file_browser.dangerous.update_properties",
  "kkterm.workspace.file_browser.dangerous.read",
  "kkterm.workspace.file_browser.dangerous.write",
  "kkterm.workspace.file_browser.dangerous.upload",
  "kkterm.workspace.file_browser.dangerous.download",
  "kkterm.workspace.file_browser.transfer_status",
  "kkterm.workspace.file_browser.dangerous.cancel_transfer",
];

test("Workspace C/D Assistant and MCP surfaces stay in parity", async () => {
  const [ai, liveTools, catalog, bridge, paneRegistry, fileBrowser, sftp, webview] = await Promise.all([
    read("src-tauri/src/ai.rs"),
    read("src/ai/assistantLiveTools.ts"),
    read("src-tauri/src/mcp_tool_catalog.rs"),
    read("src-tauri/src/mcp_bridge.rs"),
    read("src/modules/workspace/paneRegistry.ts"),
    read("src/lib/fileBrowserCommands.ts"),
    read("src/modules/workspace/connections/sftp/SftpWorkspace.tsx"),
    read("src/modules/workspace/connections/webview/WebViewWorkspace.tsx"),
  ]);

  for (const name of nativeTools) {
    assert.ok(ai.includes(`"${name}"`), `native Assistant must publish ${name}`);
    assert.ok(liveTools.includes(`case "${name}"`), `frontend live bridge must dispatch ${name}`);
  }

  for (const name of mcpTools) {
    assert.ok(catalog.includes(`"name": "${name}"`), `MCP catalog must publish ${name}`);
    assert.ok(bridge.includes(`"${name}"`), `MCP bridge must dispatch ${name}`);
  }

  const publishedNames = [...catalog.matchAll(/"name": "(kkterm\.[^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(publishedNames).size, publishedNames.length, "MCP catalog must not publish duplicate names");
  assert.ok(paneRegistry.includes('kind: "sftp" | "ftp" | "localFiles"'));
  assert.ok(paneRegistry.includes("readFile:") && paneRegistry.includes("transferStatus:"));
  assert.ok(fileBrowser.includes("localBrowserCommands"), "local File Explorer adapter must remain available");
  assert.ok(
    fileBrowser.includes("copy_local_path") && fileBrowser.includes('overwriteBehavior !== "overwrite"'),
    "local File Explorer transfers must honor overwrite semantics",
  );
  assert.ok(
    sftp.includes('kind: FileBrowserController["kind"]') && sftp.includes('"localFiles"'),
    "local File Explorer must register a live file-browser controller",
  );
  assert.ok(!sftp.includes("if (isLocalFilesBrowser || !commands || !isTauriRuntime())"));
  assert.ok(webview.includes("registerWebviewController"), "URL surfaces must register live navigation controls");
});

test("file-browser snapshots stay bounded and transfers stay queued", async () => {
  const [sftp, fileBrowser] = await Promise.all([
    read("src/modules/workspace/connections/sftp/SftpWorkspace.tsx"),
    read("src/lib/fileBrowserCommands.ts"),
  ]);

  // session_state embeds one snapshot per open browser on most turns, so the
  // snapshot must report counts instead of whole directory listings.
  assert.ok(
    sftp.includes("localEntryCount:") && sftp.includes("summarizeTransfers("),
    "the file-browser snapshot must report entry and transfer counts",
  );
  assert.ok(
    !/snapshot: \(\) => \{[\s\S]*?\n *remoteFiles,/.test(sftp),
    "the file-browser snapshot must not embed directory entries",
  );
  assert.ok(
    sftp.includes("boundedSnapshotNames("),
    "selected names in the snapshot must be bounded",
  );

  // Tool-initiated transfers join the same serialized queue as the UI's own.
  assert.ok(
    sftp.includes('origin: "assistant"') && sftp.includes("queueControllerTransfer"),
    "Assistant transfers must be queued rather than run inline",
  );
  assert.ok(
    sftp.includes("transfer.origin !== \"assistant\""),
    "queued Assistant transfers must not open the interactive overwrite prompt",
  );
  assert.ok(
    fileBrowser.includes("cancelTransfers: false"),
    "local File Explorer must declare that a started transfer cannot be canceled",
  );
  assert.ok(
    sftp.includes("commands.capabilities.cancelTransfers"),
    "cancel must report honestly when the transport cannot cancel a running transfer",
  );
});

test("C/D MCP mutations remain explicitly safety-gated", async () => {
  const [ai, catalog, bridge] = await Promise.all([
    read("src-tauri/src/ai.rs"),
    read("src-tauri/src/mcp_tool_catalog.rs"),
    read("src-tauri/src/mcp_bridge.rs"),
  ]);

  for (const nativeName of [
    "session_open_file_browser",
    "session_close_tab",
    "session_split_pane",
    "session_close_pane",
    "session_url_navigate",
    "session_file_browser_write",
    "session_file_browser_upload",
    "session_file_browser_download",
    "session_file_browser_cancel_transfer",
  ]) {
    assert.match(ai, new RegExp(`"${nativeName}"`));
  }
  for (const mcpName of [
    "kkterm.workspace.sessions.dangerous.open_file_browser",
    "kkterm.workspace.sessions.dangerous.close_tab",
    "kkterm.workspace.sessions.dangerous.url_navigate",
    "kkterm.workspace.file_browser.dangerous.write",
    "kkterm.workspace.file_browser.dangerous.upload",
    "kkterm.workspace.file_browser.dangerous.download",
  ]) {
    assert.match(catalog, new RegExp(mcpName.replaceAll(".", "\\.")));
    assert.match(bridge, new RegExp(mcpName.replaceAll(".", "\\.")));
  }
});

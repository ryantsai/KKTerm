import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace pane close buttons render for split panes and hidden Tab Strip single panes", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const canCloseSinglePane =\s*Boolean\(onClose\) \|\|\s*\(allowPaneLayoutControls && tab\.kind === "terminal" && generalSettings\.hideTopTabButtons\);/);
  assert.match(source, /canClosePane=\{panes\.length > 1 \|\| canCloseSinglePane\}/);
  assert.match(source, /canClosePane \? \(\s*<button[\s\S]*?terminal-pane-close[\s\S]*?\)\s*: null/);
  // URL panes close from their own toolbar button, so the floating overlay close
  // is suppressed for webview panes and the toolbar receives an onClose handler.
  assert.match(source, /const showOverlayClose = canClosePane && pane\.kind !== "webview";/);
  assert.match(source, /showOverlayClose \? \(\s*<button[\s\S]*?embedded-pane-close[\s\S]*?\)\s*: null/);
  assert.match(source, /<WebViewWorkspace[\s\S]*?isActive=\{isActive\}[\s\S]*?onClose=\{canClosePane \? \(\) => closePane\(tabId, pane\.id\) : undefined\}[\s\S]*?tab=\{embeddedTab\}[\s\S]*?\/>/);
});

test("embedded URL and remote desktop headers reserve close-button space only when close is visible", async () => {
  const css = await readFile(
    new URL("../src/modules/workspace/connections/terminal/terminal.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(css, /\.embedded-workspace-pane\s*>\s*\.remote-desktop-shell\s+\.remote-desktop-pane\s*>\s*header\s*\{\s*padding-right:\s*40px;/);
  // URL panes close from their own toolbar button, so no floating overlay close
  // exists for webview panes and no header padding reservation is needed.
  assert.doesNotMatch(css, /\.embedded-workspace-pane:has\([^)]*\)\s*>\s*\.webview-workspace\s+\.webview-pane\s*>\s*header\s*\{\s*padding-right:\s*40px;/);
  assert.match(css, /\.embedded-workspace-pane:has\(\s*>\s*\.embedded-pane-close\s*\)\s*>\s*\.remote-desktop-shell\s+\.remote-desktop-pane\s*>\s*header\s*\{\s*padding-right:\s*40px;/);
});

test("stored Connection layouts include URL panes and URL Connections hydrate them on open", async () => {
  const layoutSource = await readFile(
    new URL("../src/modules/workspace/layout.ts", import.meta.url),
    "utf8",
  );
  const storeSource = await readFile(
    new URL("../src/store.ts", import.meta.url),
    "utf8",
  );

  assert.match(layoutSource, /serializeLayout\(\s*layout: LayoutNode,\s*panes: WorkspacePane\[\]/);
  assert.match(layoutSource, /pane\.kind === "webview"/);
  assert.match(storeSource, /const stored = loadStoredLayout\(connection\.id\);[\s\S]*?buildPanesFromStoredLayout\(\s*connection,\s*stored,/);
  assert.match(storeSource, /stored \? hydrateLayout\(stored\.layout, paneIds\) : undefined/);
  assert.match(storeSource, /buildPaneFromStoredLayoutPane/);
});

test("Add To pane routes file-browser Connections to embedded browser panes", async () => {
  const typesSource = await readFile(new URL("../src/types.ts", import.meta.url), "utf8");
  const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  const terminalWorkspaceSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(typesSource, /export interface FileBrowserPane[\s\S]*kind: "sftp" \| "ftp" \| "localFiles"/);
  assert.match(typesSource, /WorkspacePane =\s*\| TerminalPane\s*\| UrlPane\s*\| RemoteDesktopPane\s*\| FileBrowserPane\s*\| FileViewerPane;/);
  assert.match(
    storeSource,
    /if \(connection\.type === "ftp"\) \{[\s\S]*?kind: isSftpProtocol \? "sftp" : "ftp"[\s\S]*?connection: fileConnection/,
    "FTP and SFTP-protocol FTP Connections should create file-browser panes, not terminal panes",
  );
  assert.match(
    storeSource,
    /if \(connection\.type === "localFiles"\) \{[\s\S]*?kind: "localFiles"[\s\S]*?connection,/,
    "File Explorer Connections should create localFiles panes, not terminal panes",
  );
  assert.match(
    terminalWorkspaceSource,
    /import \{ fileBrowserCommandsFor \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/fileBrowserCommands"/,
  );
  assert.match(
    terminalWorkspaceSource,
    /const fileBrowserCommands = useMemo\([\s\S]*?fileBrowserCommandsFor\(pane\.connection\)[\s\S]*?\[pane\.kind, pane\.connection\]/,
    "embedded file-browser panes should keep a stable commands adapter while selection state changes",
  );
  assert.match(
    terminalWorkspaceSource,
    /case "sftp":\s*case "ftp":\s*case "localFiles":[\s\S]*?<SftpWorkspace[\s\S]*?commands=\{fileBrowserCommands \?\? undefined\}/,
    "embedded file-browser panes should render through SftpWorkspace with the transport adapter",
  );
});

test("Add To pane can split standalone browser tabs", async () => {
  const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    storeSource,
    /function buildPaneForStandaloneTab\(tab: WorkspaceTab\): WorkspacePane \| null[\s\S]*?tab\.kind === "webview"[\s\S]*?tab\.kind === "sftp" \|\| tab\.kind === "ftp" \|\| tab\.kind === "localFiles"/,
    "standalone URL/SFTP/FTP/File Explorer tabs should be convertible to the first layout pane",
  );
  assert.match(
    storeSource,
    /const basePane = tab\.kind === "terminal" \? null : buildPaneForStandaloneTab\(tab\);[\s\S]*?const currentPanes = tab\.kind === "terminal" \? tab\.panes : basePane \? \[basePane\] : \[\];[\s\S]*?kind: "terminal"/,
    "adding a Connection to a standalone browser tab should convert it into a split layout tab",
  );
  assert.doesNotMatch(
    sidebarSource,
    /activeTab \|\| activeTab\.kind !== "terminal"/,
    "Add To should not fall back to opening a new tab for standalone browser tabs",
  );
  assert.match(
    sidebarSource,
    /function supportsAddConnectionToTab\(tab: WorkspaceTab \| undefined\)[\s\S]*?tab\.kind === "webview"[\s\S]*?tab\.kind === "sftp"[\s\S]*?tab\.kind === "localFiles"/,
    "Connection Tree menus should offer Add To directions for standalone browser tabs",
  );
  assert.match(
    sidebarSource,
    /const canAddToPane = supportsAddConnectionToTab\(tabs\.find\(\(tab\) => tab\.id === activeTabId\)\)/,
  );
  assert.match(
    sidebarSource,
    /canAddToPane=\{supportsAddConnectionToTab\(tabs\.find\(\(tab\) => tab\.id === activeTabId\)\)\}/,
  );
});

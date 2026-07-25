import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Connection Tree supports forced new Tabs from Ctrl-click and Add to menu", async () => {
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );
  const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");

  assert.match(storeSource, /openConnectionInNewTab:\s*\(\s*connection: Connection/);
  assert.match(storeSource, /createConnectionTabId\(connection\.id\)/);
  assert.match(storeSource, /function createPaneId\(connectionId: string\)/);
  assert.doesNotMatch(
    storeSource,
    /id:\s*`pane-\$\{connection\.id\}-\$\{Date\.now\(\)\}`/,
    "panorama panes need unique ids even when multiple children are opened in one millisecond",
  );
  assert.doesNotMatch(
    storeSource,
    /if \(existingGroupTab\) \{\s*set\(\{ activeTabId: existingGroupTab\.id \}\);\s*return;\s*\}/,
    "parent clicks should refresh an existing Child Connection Tab panorama instead of only activating it",
  );
  assert.match(
    storeSource,
    /childConnectionGroupParentId: connection\.id,[\s\S]*?focusedPaneId: focusedPaneIdForChildLayout\(existingGroupTab,\s*childPanes\),/,
    "parent panorama activation should restore the previously focused child Pane when reopening a live child layout",
  );
  assert.match(
    storeSource,
    /layout: existingGroupTab && convertedPlainPaneIds\.size === 0\s*\?\s*reconcilePanoramaLayout\(existingGroupTab\.layout,\s*childPanes\)\s*:\s*panoramaLayoutFor\(childPanes\)/,
    "parent panorama rebuilds should retain deliberate mixed splits while balancing legacy flat rows",
  );
  assert.match(
    storeSource,
    /maximizeChildConnectionPane:\s*\(tabId,\s*paneId\)/,
    "Child Connection Tab activation from a parent panorama should maximize that pane",
  );
  assert.match(
    storeSource,
    /maximizedPaneId: undefined/,
    "parent panorama activation should restore the full child panorama while preserving focus",
  );
  assert.match(
    sidebarSource,
    /maximizeChildConnectionPane\(existingChildLocation\.tab\.id,\s*existingChildLocation\.pane\.id\)/,
    "clicking a child row inside an existing parent panorama should use the maximize path",
  );
  assert.match(
    storeSource,
    /closeChildConnection:\s*\(childConnectionId\)/,
    "closing a Child Connection Tab should close by child id rather than by parent panorama tab id",
  );
  assert.match(
    storeSource,
    /CHILD_CONNECTION_CLOSED_EVENT/,
    "closing from a terminal pane should notify the Connection Tree to remove the child row",
  );
  assert.match(
    sidebarSource,
    /label: t\("common\.close"\)/,
    "Child Connection Tab context menu should include Close",
  );
  assert.match(
    sidebarSource,
    /<ConnectionStatusIndicator[\s\S]*?status=\{connected \? "connected" : "idle"\}/,
    "Child Connection Tab rows should show their own connection status dot",
  );
  assert.match(
    sidebarSource,
    /isActiveParent=\{isActiveParent\}/,
    "parent Connection rows should keep their own active highlight",
  );
  assert.match(
    sidebarSource,
    /activeTab\?\.childConnectionGroupParentId === connection\.id/,
    "parent Connection rows should remain active when a focused child Pane is restored in the panorama",
  );
  assert.match(
    sidebarSource,
    /if \(showChildTabsInTree && isTerminalConnectionType\(connection\.type\)\) \{[\s\S]*?if \(children\.length > 0\) \{[\s\S]*?openChildConnectionLayout\(connection,\s*children\);[\s\S]*?createChildConnection\(connection\)\.then\(\(child\) => \{[\s\S]*?openChildConnectionLayout\(connection,\s*\[child\]\);/,
    "clicking a terminal parent with zero children in child mode should create one child and show it",
  );
  assert.match(
    sidebarSource,
    /isChildConnectionRowActive\(\{[\s\S]*?activeTabId,[\s\S]*?paneId: location\?\.paneId,[\s\S]*?tab,[\s\S]*?\}\)/,
    "Child Connection Tab rows should only become active through the shared child-row active-state helper",
  );
  assert.match(
    storeSource,
    /workspaceId: get\(\)\.activeWorkspaceId/,
    "new workspace Tabs should remember the Workspace that opened them",
  );
  assert.match(
    storeSource,
    /tab\.childConnectionGroupParentId === connection\.id &&[\s\S]*?\(tab\.workspaceId \?\? DEFAULT_WORKSPACE_ID\) === activeWorkspaceId/,
    "parent child-layout reopen should only reuse a group Tab from the active Workspace",
  );
  assert.match(
    sidebarSource,
    /const childWorkspaceId = child\.workspaceId \?\? DEFAULT_WORKSPACE_ID;[\s\S]*?childWorkspaceId === activeWorkspaceId/,
    "Child Connection Tab rows should be scoped to the active Workspace, with legacy rows kept in Default",
  );
  assert.match(
    sidebarSource,
    /const tabWorkspaceId = tab\.workspaceId \?\? DEFAULT_WORKSPACE_ID;[\s\S]*?tabWorkspaceId === activeWorkspaceId/,
    "open child-tab locations should only come from Tabs owned by the active Workspace",
  );
  assert.match(
    sidebarSource,
    /const isConnected = \(activeSessionCounts\[menu\.connection\.id\] \?\? 0\) > 0;/,
    "connected Connection rows should expose a Close Connection menu item",
  );
  assert.match(
    sidebarSource,
    /label: t\("connections\.closeConnection"\)/,
    "Close Connection must be translated through i18n",
  );
  assert.match(
    sidebarSource,
    /function handleTreeMenuCloseConnection\(menu: TreeContextMenuState\)/,
    "Close Connection should close open tabs for that durable Connection",
  );
  assert.match(
    sidebarSource,
    /function closeOpenTabsForConnection\(connectionId: string\)[\s\S]*?pane\.connection\?\.id === connectionId[\s\S]*?if \(tab\.connection\?\.id === connectionId\) \{[\s\S]*?closeTab\(tab\.id\);[\s\S]*?if \(matchingPaneIds\.length === tab\.panes\.length\) \{[\s\S]*?closeTab\(tab\.id\);[\s\S]*?closePane\(tab\.id, paneId\);[\s\S]*?function handleTreeMenuRename/,
    "Connection delete should close any open Tab or Pane for the durable Connection",
  );
  assert.match(
    sidebarSource,
    /await invokeCommand\("delete_connection"[\s\S]*?closeOpenTabsForConnection\(connection\.id\);[\s\S]*?await reloadConnectionGroups/,
    "Deleting a Connection should close its open workspace surface before reloading the tree",
  );
  assert.match(storeSource, /openSftpBrowserInNewTab: \(connection: Connection\) => void/);
  assert.match(storeSource, /get\(\)\.openSftpBrowserInNewTab\(sshConnection\)/);
  assert.match(sidebarSource, /openConnectionInNewTab = useWorkspaceStore/);
  assert.match(sidebarSource, /event\.ctrlKey/);
  assert.match(sidebarSource, /handleOpenConnection\(connection,\s*\{\s*forceNewTab: true\s*\}\)/);
  assert.match(
    storeSource,
    /!pane\.tmuxSessionId[\s\S]*?fallbackPane\.tmuxSessionId[\s\S]*?tmuxSessionId: fallbackPane\.tmuxSessionId/,
    "stored single-pane SSH layouts should inherit generated tmux ids so the toolbar can show tmux controls",
  );
  assert.match(
    storeSource,
    /sameConnection[\s\S]*?connection: fallbackPane\.connection[\s\S]*?pane\.tmuxUnavailable \? undefined : fallbackPane\.tmuxSessionId/,
    "stored same-Connection panes should refresh stale Connection metadata without resurrecting tmux controls after tmux is unavailable",
  );
  assert.match(
    storeSource,
    /const tmuxDisabled =[\s\S]*?fallbackPane\.connection\.useTmuxSessions === false[\s\S]*?tmuxSessionId: tmuxDisabled\s*\?\s*undefined/,
    "stored SSH panes should clear stale tmux ids when the current durable Connection disables tmux",
  );
  assert.match(
    storeSource,
    /function refreshTerminalPaneConnection[\s\S]*?connection\.useTmuxSessions === false[\s\S]*?tmuxSessionId: tmuxDisabled \? undefined : pane\.tmuxSessionId/,
    "reactivating an existing SSH tab should clear stale tmux ids when the current durable Connection disables tmux",
  );
  assert.match(
    storeSource,
    /existingTab[\s\S]*?refreshTabConnectionMetadata\(tab,\s*connection\)[\s\S]*?activeTabId: existingTab\.id/,
    "opening an already-live Connection should refresh stale Tab metadata before reactivation",
  );
  assert.match(
    storeSource,
    /tmuxUnavailable: true/,
    "remote hosts without tmux should keep suppressing tmux controls after the startup marker is detected",
  );
  assert.match(sidebarSource, /openTmuxSessionIdsForConnection\(connection\.id\)/);
  assert.match(sidebarSource, /newestUnattachedTmuxSession\(sessions,\s*openSessionIds\)/);
  assert.match(sidebarSource, /label: `\$\{t\("workspace\.newTab"\)\}\\t\$\{t\("connections\.newTabShortcut"\)\}`/);
  assert.match(sidebarSource, /action: \(\) => handleTreeMenuOpenNewTab\(menu\)/);
  assert.match(
    sidebarSource,
    /const canOpenNewTab =[\s\S]*?!showChildTabsInTree \|\| isTerminalConnectionType\(menu\.connection\.type\);/,
    "Add Tab should only be disabled for non-terminal Connections when Child Connection Tabs are enabled",
  );
  assert.match(
    sidebarSource,
    /label: `\$\{t\("workspace\.newTab"\)\}\\t\$\{t\("connections\.newTabShortcut"\)\}`,[\s\S]*?disabled: !canOpenNewTab,/,
    "native Add to > Add Tab should be disabled for non-terminal Child Connection Tab targets",
  );
  assert.match(
    sidebarSource,
    /label: t\("workspace\.newTab"\),[\s\S]*?disabled: !canOpenNewTab,[\s\S]*?iconSvg: nativeMenuIcons\.squarePlus,/,
    "native top-level Add Tab should be disabled for non-terminal Child Connection Tab targets",
  );
  assert.match(
    sidebarSource,
    /<button disabled=\{!canOpenNewTab\} onClick=\{onOpenNewTab\}/,
    "DOM fallback Add Tab should be disabled for non-terminal Child Connection Tab targets",
  );
});

test("the Workspace new-Tab shortcut reuses the active Connection", async () => {
  const canvasSource = await readFile(
    new URL("../src/modules/workspace/WorkspaceCanvas.tsx", import.meta.url),
    "utf8",
  );
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    canvasSource,
    /case "newTab":[\s\S]*?activeConnectionForNewTab\(state\.tabs, state\.activeTabId\)[\s\S]*?requestConnectionNewTab\(connection\)/,
    "Ctrl+Shift+T should request another Tab for the active focused Connection",
  );
  assert.doesNotMatch(
    canvasSource.match(/case "newTab":[\s\S]*?break;/)?.[0] ?? "",
    /openLocalTerminal/,
    "the new-Tab shortcut must not fall back to a local terminal",
  );
  assert.match(
    sidebarSource,
    /NEW_CONNECTION_TAB_REQUEST_EVENT[\s\S]*?handleOpenConnectionInNewTab\(detail\.connection\)/,
    "the shortcut should reuse the Connection Tree's top-Tab or Child Connection Tab creation path",
  );
});

test("Child Connection panorama converts parent Panes and preserves unnamed split Panes", async () => {
  const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );
  const childConnectionsSource = await readFile(
    new URL("../src/modules/workspace/connections/childConnections.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    childConnectionsSource,
    /export function convertOpenTabsToChildConnections/,
    "child mode should expose a testable helper for converting open top-strip Tabs",
  );
  assert.match(
    childConnectionsSource,
    /id: pane\.id,[\s\S]*?parentConnectionId: paneConnection\.id,/,
    "converted parent Panes should become child rows keyed by the live Pane id",
  );
  assert.match(
    childConnectionsSource,
    /export function collectPreservedParentPanes/,
    "child layout reconciliation should still expose a testable helper for preserved Panes",
  );
  assert.match(
    childConnectionsSource,
    /existingGroupTab\s*\n?\s*\?\s*existingGroupTab\.panes\.filter\(\(pane\) => !pane\.childConnectionId && !claimed\.has\(pane\.id\)\)/,
    "in-panorama split Panes (no childConnectionId) must be carried forward only when not claimed as converted children",
  );
  assert.match(
    storeSource,
    /const \{ carriedGroupPanes, adoptedOrphanPanes \} = collectPreservedParentPanes\(/,
    "openChildConnectionLayout should fold preserved Panes into the panorama",
  );
  assert.match(
    storeSource,
    /convertedPlainPaneIds\.add\(pane\.id\);[\s\S]*?externalPaneByChildId\.set\(paneChildId,\s*\{ pane,\s*tab \}\);/,
    "plain parent Panes matching converted child ids must be claimed as named child Panes",
  );
  assert.match(
    storeSource,
    /const childPanes = \[\.\.\.namedChildPanes, \.\.\.carriedGroupPanes, \.\.\.adoptedOrphanPanes\];/,
    "the rebuilt panorama must include named children plus any unclaimed carried Panes",
  );
  assert.match(
    sidebarSource,
    /convertOpenTabsToChildConnections\(\{[\s\S]*?children: syncChildConnectionsFromTabs\(current,\s*tabs\),[\s\S]*?activeWorkspaceId,[\s\S]*?defaultWorkspaceId: DEFAULT_WORKSPACE_ID,/,
    "enabling child mode should convert already-open terminal Tabs into Child Connection Tabs",
  );
});

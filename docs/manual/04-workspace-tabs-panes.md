# 04 — Workspace, Tabs, and Panes

## AI grep hints

- Keys: `workspace.tabs`, `workspace.newTab`, `workspace.closeTab`, `workspace.noActiveSession`, `workspace.openFromTree`, `workspace.terminalPane`, `workspace.sftpBrowser`, `workspace.webview`, `app.openFile`, `settings.hideTopTabButtons`, `settings.hideTopTabButtonsDesc`, `connections.childConnectionProperties`, `terminal.splitLayout`, `terminal.splitRight`, `terminal.splitLeft`, `terminal.splitDown`, `terminal.splitUp`, `terminal.saveLayout`, `terminal.resetLayout`, `terminal.layoutSaved`, `terminal.layoutReset`, `terminal.closePane`, `terminal.closePaneTitle`, `terminal.focusPane`, `terminal.openLeft`, `terminal.openRight`, `terminal.openAbove`, `terminal.openBelow`
- Topics: tab strip, ephemeral file/folder Tabs, Child Connection Tabs, connection tree tabs, new tab, close tab, drag tabs, split panes, drag-to-dock, docking overlay, focus pane, tutorial targets `workspace.tabStrip`, `workspace.canvas`, `workspace.emptyState`
- Synonyms: "temporary tab", "open with KKTerm", "split view", "open side by side", "horizontal split", "new pane", "child tab", "saved tab", "sub tab", "tabs in connection tree", "drag connection to split", "dock pane", "snap pane", "drag and drop split", "Visual Studio docking"

## Tab Strip

Horizontal row above the Workspace Canvas. Accessible label `workspace.tabs`. The Tab Strip is scoped to the active Workspace: switching Workspaces in the Activity Rail shows only open Tabs that belong to the destination Workspace, activates the first open Tab there, or shows the empty Workspace state when that Workspace has no open Tabs. Tabs from other Workspaces remain open in the background until explicitly closed. Scroll affordances: `workspace.scrollTabsLeft`, `workspace.scrollTabsRight`. Dragging a Tab left or right onto another Tab reorders it to that position; the reorder is runtime-only and is not restored after app restart. Double-clicking a Tab title starts inline rename with accessible label `workspace.renameTab`. Tab rename is runtime-only per Tab: it changes the open Tab's `displayTitle`, does not update Connection metadata, and is not restored after app restart. Middle-clicking a Tab closes it through the same close path as the close button. Per-tab close label uses `workspace.closeTab` with the tab title interpolated as `{{title}}`.

On Windows, a muted plus at the trailing edge opens the native file picker directly. When `settings.hideTopTabButtons` replaces the strip with Child Connection Tabs, `app.openFile` moves to the compact title-bar chevron; the two entry points are never shown together.

A new tab opens via:

- Opening a Connection from the tree (`workspace.openFromTree`).
- The `workspace.newTab` button.
- Quick Connect.
- "Open in pane" from the rail (`app.openConnectedConnection`).
- An operating-system or command-line file/folder launch (ephemeral Document or File Explorer Tab).

Empty state (no Tabs open) shows `workspace.noActiveSession` over the Default Launch State. Below `workspace.openFromTree`, centered direct creation links open the existing add flow for every supported Connection type: Local Terminal, SSH, Telnet, Serial, URL, RDP, VNC, FTP/FTPS, File Explorer, and Document; `workspace.importConnections` opens the existing import flow. These empty-state actions reveal the active Workspace's Connection Tree when it is hidden. A Connection created from a direct creation link opens immediately after it is saved. Document uses its existing file picker before creating and opening the Connection.

Tutorial targets: `workspace.tabStrip`, `workspace.canvas`, `workspace.emptyState`.

File/folder launch Tabs are runtime-only. They belong to the active Workspace while open, but do not create a durable Connection, a Child Connection Tab, or a saved layout, and they are not restored on the next launch. Opening a file from an ephemeral File Explorer Tab remains ephemeral even when `settings.hideTopTabButtons` is enabled.

## Child Connection Tabs

Child Connection Tabs are the alternate Workspace tab model enabled by `settings.hideTopTabButtons`. In this mode, the top Tab Strip is hidden and each saved Tab for a terminal-type Connection appears as an italic child row under that parent Connection in the active Workspace's Connection Tree. Non-terminal Connections disable the Add Tab action in this mode.

A Child Connection Tab stores Workspace presentation and reopen hints:

- Child Tab name, shown in the tree and as the Pane toolbar title.
- Owning Workspace id, so switching Workspaces hides child rows and open child-tab locations that belong to another Workspace without closing their live Sessions.
- Optional child-specific icon image, icon foreground, and icon background.
- Optional tmux session id for tmux-enabled SSH.
- Optional last terminal working directory for non-tmux terminal children.

It does not duplicate the parent Connection's host, protocol, or credential metadata, and it is not a live Session while the app is closed. On app launch, Child Connection Tabs are restored as rows only; selecting a child row starts the actual Session. Tmux-enabled SSH children use the tmux session id as the default Child Connection Tab name and reopen the same tmux session. Non-tmux terminal children pass their last reported working directory back as the startup directory when reopened. Child terminal font size, transparency, and background are stored on the Child Connection Tab so relaunching the child row restores its own appearance instead of inheriting the parent Connection's current terminal appearance.

Right-clicking a Child Connection Tab exposes `connections.rename` and `connections.properties`; the properties dialog `connections.childConnectionProperties` edits the child Tab name, icon image, icon foreground, and icon background. Double-clicking the child row name starts inline rename.

Selecting the first Child Connection Tab creates one live group Tab owned by its parent Connection and maximizes that child's Pane. Selecting more child rows adds their Panes to the same group and maximizes the selected child; it does not create or move between separate live Tabs. Selecting the parent Connection adds any unopened children, clears maximization, and reveals those same mounted Panes as the panorama without reconnecting their Sessions or resetting their terminal screens. A group created with several children starts with a balanced layout: two children use a left/right split, three use two Panes above one Pane, and larger sets distribute Panes across balanced grid-style rows (seven Panes use rows of four and three). Once Panes are live, subsequent additions preserve their existing layout positions rather than rebalancing mounted terminal renderers. Parent panorama activation restores the previously focused child Pane when it is still present and returns terminal input focus to it. The parent Connection row is the active tree target for the full panorama; a child row is active only while that child Pane is opened as the maximized child view.

## Tab right-click menu

Native Tauri context menu (`src/lib/nativeContextMenu.ts`). Items vary by Tab kind but typically include rename, close, and split actions. Tab drag/drop reorders Tabs.

## Panes

A Tab subdivides into Panes. Each Pane is a single terminal surface or workspace view. Panes are arranged in a recursive split tree.

### Splitting

From the Pane toolbar `terminal.splitLayout`:

- `terminal.splitRight`, `terminal.splitLeft`, `terminal.splitUp`, `terminal.splitDown`.

When opening a Connection from the tree with a target Pane focused, the `connections.layout` submenu (`connections.left`, `connections.right`, `connections.upper`, `connections.lower`) controls placement. When Child Connection Tabs are enabled, using those placement commands on a terminal parent creates a new Child Connection Tab and docks its Pane beside the active Pane in the parent panorama instead of creating an unnamed ephemeral Pane. Tmux session menus offer `terminal.openLeft`, `terminal.openRight`, `terminal.openAbove`, `terminal.openBelow` for spawning attached Panes (see [06-ssh-and-tmux.md](06-ssh-and-tmux.md)).

### Drag-to-dock

You can also drag a Connection from the Connection Tree onto the Workspace Canvas to place it spatially, Visual Studio-style. While dragging over any active Tab surface, a docking overlay appears: a faint outline frames the Pane under the pointer and an accent-tinted highlight previews the snap region. The highlight follows the nearest edge - left, right, top, or bottom - and glides between edges and Panes as you move. Releasing splits that specific Pane in the previewed direction (it does not require the Pane to be focused first). When Child Connection Tabs are enabled, dragging a terminal parent into a dock zone creates a new Child Connection Tab for the dropped Pane. Dropping onto a standalone Connection Tab, such as File Explorer, Document, URL, RDP/VNC, FTP, or SFTP, first converts that Tab into the shared split-Pane layout and keeps the original surface as the first Pane. Dropping a Connection onto an empty Canvas (no Tab open) opens it as a new Tab. This is a pointer interaction with no menu label.

Split Panes use a narrow gutter so panorama layouts keep as much Canvas space as possible for Session content.

### Focus

`terminal.focusPane` switches the active Pane. Pane focus follows mouse click and keyboard tab cycling. Terminal Panes use xterm.js, which is backed by a hidden textarea — WebView2 focus quirks can affect input. Validate focus behaviour with the real Tauri runtime, not a browser preview.
When returning to Workspace or selecting a different focused terminal Pane, KKTerm restores text input focus to that Pane so typing continues without an extra click.

### Closing

`terminal.closePane` / `terminal.closePaneTitle` closes a single Pane. The Pane toolbar close button is shown only when the Tab has multiple Panes; closing the whole single-Pane Tab uses the Tab Strip `workspace.closeTab` action. Closing the last Tab returns to the Default Launch State.

In a Child Connection Tab panorama, closing one child ends only that child's Session. If one sibling remains, its existing Session and terminal screen stay intact while the panorama becomes a single full-size Pane.

### Saved layouts

`terminal.saveLayout` saves the current split Pane layout for the Connection. `terminal.resetLayout` removes the saved layout. Status Bar confirmations use `terminal.layoutSaved` and `terminal.layoutReset`.

Durable per-Tab titles, icons, colors, and restoring multiple Tab Instances for one Connection are deferred roadmap decisions. Until that model exists, saved layouts remain Connection-level Pane layouts rather than saved Tab Instances.

> A Session ends only when its presenting Tab/Pane is explicitly closed or the remote/process ends itself. Switching Tabs does **not** end Sessions. Quiet SSH Sessions stay connected indefinitely — there is no app-side idle timeout.

## Pane content types

Each Pane renders one of:

- `workspace.terminalPane` — terminal (local, SSH, Telnet, Serial). See [05-terminal.md](05-terminal.md).
- `workspace.sftpBrowser` — SFTP/FTP/File Explorer browser. See [07-sftp.md](07-sftp.md).
- Document (`connections.fileView`, Pane kind `fileViewer`) — single-file viewer / light editor. See [03-connections.md](03-connections.md).
- `workspace.webview` — URL Connection (WebView2). See [08-url-webview.md](08-url-webview.md).
- RDP / VNC surface (`remoteDesktop.session`). See [09-remote-desktop.md](09-remote-desktop.md).

## Sending content to the AI Assistant

From a Pane right-click menu:

- `terminal.copySelection` — copy current xterm selection.
- `terminal.sendToAi` — push selection or full buffer into the AI Assistant input. Status: `ai.addedToPane`.
- `terminal.terminalSelection` / `terminal.terminalBuffer` — chooses between the selection or full scrollback.

Screenshot capture from a Pane is covered in [14-screenshots.md](14-screenshots.md).

# 07 — SFTP

## AI grep hints

- Keys: `sftp.*` (full namespace), `terminal.openSftp`, `terminal.sftp`, `compare.*` (File Compare overlay)
- Topics: symmetric dual-pane browser, breadcrumb navigation, list/gallery view switch, per-pane view-options (hamburger) menu with item zoom + content-view background, upload, download, conflicts, cut/copy/paste, rename, delete, copy path, new folder, properties, chmod/chown, sort, collapsible transfer activity bar, SFTP debug log, file compare (select left / compare to, text/image/hex, difference heatmap), tutorial targets `sftp.toolbar`, `sftp.upload`, `sftp.download`, `sftp.terminal`, `sftp.localPane`, `sftp.remotePane`, `sftp.transferQueue`
- Synonyms: "file transfer", "scp", "upload to server", "download from server", "remote files", "diff files", "compare files", "beyond compare", "hex compare", "image diff", "sftp.debug.log", "SFTP upload stuck"

## Opening an SFTP browser

SFTP is not a standalone Connection kind. Open an SFTP browser popup from an SSH Pane's toolbar (`terminal.openSftp` / `terminal.sftp`) or open an SFTP Pane from the SSH Connection's right-click menu in the Connection Tree. The SSH-toolbar popup can switch its file-transfer protocol from the titlebar change button (`sftp.protocolSelectorAria`) next to the protocol title between SFTP, explicit FTPS (`sftp.protocolFtpsExplicit`), implicit FTPS (`sftp.protocolFtpsImplicit`), and plain FTP (`sftp.protocolFtp`). The same menu includes the runtime port; default ports are SFTP 22, explicit FTPS 21, implicit FTPS 990, and plain FTP 21. For SFTP, an SSH Connection's saved port is used instead of 22 when it is present. KKTerm remembers the last successfully connected protocol and port for that SSH Connection in localStorage and uses them the next time the popup opens. If FTPS fails, the popup retries plain FTP, uses the standard Status Bar warning notice (`sftp.ftpsFallbackStatus`), and shows the titlebar warning (`sftp.plainFtpWarning`) because plain FTP is not encrypted.

The SSH Pane toolbar popup behaves the same whether the top Tab Strip is visible or hidden.

**Start folders.** The SSH-toolbar popup opens its remote pane at the SSH session's current working directory when the remote shell reports one (OSC 7); otherwise it opens at the remote home directory. Its local pane reopens the last local folder browsed for that SSH Connection (remembered in localStorage per Connection), falling back to the home directory. A standalone FTP/FTPS/SFTP Connection Tab opens its local pane at the Connection's `connections.ftpLocalPath` and its remote pane at `connections.ftpRemotePath` (see [03-connections.md](03-connections.md)); when either is empty — or the configured folder cannot be opened — the pane falls back to the local home directory or the server's default directory respectively.

Startup states:

- `sftp.connecting`
- `sftp.verifyingHost` (SSH host key verification — see [06-ssh-and-tmux.md](06-ssh-and-tmux.md))
- `sftp.openingProtocol`
- `sftp.connected`
- `sftp.refreshing`
- `sftp.openingFolder`
- `sftp.noSshConnection` (cannot resolve the parent SSH Connection)
- `sftp.tauriUnavailable` (runtime check)
- `sftp.sessionUnavailable`
- `sftp.passwordDialogTitle` / `sftp.passwordDialogBody` (the SSH/FTP password is not saved and must be entered transiently before the browser can connect)
- `sftp.ftpConnectionErrorTitle` (FTP connection errors open an app-owned dialog instead of rendering in the transfer queue)

## Layout

The browser follows the KKTerm design language (see [DESIGN_LANGUAGE.md](../DESIGN_LANGUAGE.md)): a symmetric dual-pane file manager with a center transfer-arrow gutter and a collapsible transfer-activity bar at the bottom. A single-row titlebar shows, left to right: a transfer glyph + the protocol kind (`sftp.protocolSftp` / `sftp.protocolFtp` / `sftp.protocolFiles`) and, for SSH-toolbar popups, a subtle protocol change button (`sftp.protocolSelectorAria`); the `user@host` centered; and the right-side actions (the `sftp.terminal` action for standalone panes, a compact connection status `sftp.connected` / `sftp.connecting` / `sftp.notConnected`, and a `common.close` button shown for the SFTP popup and for standalone SFTP / File Explorer Tabs whenever `settings.hideTopTabButtons` hides the top Tab Strip's per-Tab close). When a connection fails, the titlebar status shows `sftp.notConnected` (red). FTPS fallback uses the standard Status Bar warning notice. FTP connection errors open an app-owned dialog; transfer failures remain in the transfer activity history. Plain FTP keeps only the compact `sftp.plainFtpWarning` titlebar chip.

File Explorer Connections (`localFiles`) reuse this browser shell as a single-pane local browser: the titlebar shows the saved Connection name, and only the local file pane is shown, with no remote pane, center transfer gutter, connection-status pill, or bottom Transfer Activity bar.

Each pane header shows the pane label, a **breadcrumb** path, and per-pane actions. Click a breadcrumb segment to jump to that ancestor folder. **Double-click the breadcrumb** (`sftp.editPathTitle`) to switch it to an editable path field: type a local or remote path and press Enter to navigate, or Escape to cancel. Folder-name autocomplete suggests folders from the current listing and inserts the selected folder path with a trailing slash. The local pane's terminal icon (`sftp.openTerminalHereAria`) opens a runtime-only terminal popup in the current local folder using the dedicated Settings → File Explorer terminal preference (`settings.fileExplorerTerminal`). The popup follows the SSH toolbar SFTP popup model: it does not create a workspace Tab or connected Activity Rail item, renders the terminal edge-to-edge without a light dialog gutter, and puts its `terminal.closePane` action at the top-right of the terminal toolbar. Closing it ends the terminal Session. Windows offers normal and administrator variants of Command Prompt, PowerShell, and PowerShell 7; macOS defaults to zsh; Linux defaults to bash; reusable custom shells come from Terminal settings. In SFTP/FTP browsers this action is local-side only and is not shown on the remote pane. The recent-path icon (`sftp.recentPathsAria`) opens up to the last five visited paths for that pane. The path input accessibility label is `sftp.pathInputAria`.

The editable path and inline rename fields disable OS autocorrect,
autocapitalization, and spellcheck in the WebView on Windows and macOS so file
names and paths are entered exactly as typed. Platform keyboard/IME suggestion
UI may still appear outside KKTerm's DOM controls.

Each pane offers a **view switch** (`sftp.viewMode`) between list (`sftp.listView`) and gallery (`sftp.galleryView`). List view has sortable column headers for `sftp.name`, `sftp.size`, and `sftp.date` (click a header to toggle ascending/descending).

- **Local** (`sftp.local`, `sftp.localFiles`) — loading state `sftp.loadingLocal`. On Windows, opening the parent of a drive root shows the drive picker path label `sftp.windowsDrives`, where double-clicking a drive opens that drive root.
- **Remote** (`sftp.remote`) — empty state `sftp.noFiles`, loading `sftp.loading`.

The bottom **Transfer Activity** bar (`sftp.transferActivity`, tutorial target `sftp.transferQueue`) is collapsible. Its summary shows `sftp.transferringStatus` while transfers run, `sftp.transfersIdleStatus` once they finish, or `sftp.noTransfers` when empty; the expanded panel hint is `sftp.transferHint`. Clear completed: `sftp.clear`.

Tutorial targets: `sftp.toolbar`, `sftp.localPane`, `sftp.remotePane`, `sftp.transferQueue`.

## Per-pane toolbar

Each pane header carries (with `Aria` siblings for accessibility):

- Open parent: `sftp.openParent` (`sftp.openParentFolderAria`)
- New folder (remote): `sftp.createFolder` (`sftp.createFolderAria`). Remote new folder dialog `sftp.newRemoteFolder` — empty input warning `sftp.folderNameBlank`. Creation in-flight: `sftp.creatingFolder`.
- Recent paths (`sftp.recentPathsAria`) and Refresh files: `sftp.refreshFiles` (`sftp.refreshFilesAria`)
- View switch: list / gallery (`sftp.viewMode`).
- View options (`sftp.viewOptions`) — a hamburger button to the right of the search box opens a per-pane menu with two controls: **Zoom** (`sftp.zoom`, slider aria `sftp.zoomAria`) scales the file/folder items in that pane's content view smaller or bigger, and **Background** (`sftp.background`) opens the shared background picker (same options as a Dashboard view background; default-mode hint `sftp.backgroundDefaultHint`) and applies the chosen preset / image / video / dynamic background within that pane's content view only. Dynamic backgrounds do not react to pointer clicks or presses; Particle Cursor, Silk Aurora, Closing Plasma, and Liquid Chrome may follow unpressed pointer movement. Both panes of an SFTP/FTP browser carry their own menu. These settings persist per Connection and per pane side, except in the ephemeral SSH-toolbar SFTP popup, where they are kept in memory only and forgotten when the popup closes.

Cut, Copy, Paste, Rename, Copy Path, Delete, and Get Info are on the right-click context menu (see below). Pressing **Delete** or **Backspace** with a mutable local or remote selection starts the delete flow (remote confirm copy `sftp.deleteRemoteConfirm`, `sftp.deleteRemoteItemConfirm`, `sftp.deleteRemoteItemsMultiple`; local confirm copy reuses `sftp.deleteLabel` / `sftp.deleteSelected`; in-flight `sftp.deleting`). Rename in-flight `sftp.renaming` / empty warning `sftp.remoteNameBlank`; rename file aria `sftp.renameFileAria`.

Double-click affordance hint: `sftp.doubleClickToOpenFile`. Double-clicking a local file runs the operating system's normal Open action for that file. Double-clicking a remote file downloads it to the current local pane directory, then runs the operating system Open action only after the transfer completes successfully; canceled, skipped, or failed downloads do not open. Remote symbolic links that resolve to directories are listed as openable folder entries so double-clicking enters the resolved target directory.

## Transferring files

Use drag/drop between panes or the **center transfer arrows** (`sftp.upload` to the remote pane, `sftp.download` to the local pane). Dropping files directly from the OS file manager onto the remote Pane is not supported, because KKTerm runs with the webview's native drag-drop handler disabled (required so in-app HTML5 drag-and-drop works on Windows), which means OS file drops never report a path — drag from the local pane or use the transfer arrows instead. Standalone SFTP panes expose a `sftp.terminal` action that reopens the parent SSH terminal in the originating Pane; SFTP popups opened from an active SSH terminal omit that action because closing the popup returns to the parent terminal. The SFTP browser and File Explorer (`localFiles`) do not show a screenshot / send-to-AI toolbar action.

The right-click file clipboard uses `common.cut`, `common.copy`, and `common.paste`. Local file selections are also written to the Windows Explorer file clipboard, so Explorer can paste copied/cut local items from KKTerm and KKTerm can paste copied/cut local items from Explorer. Cross-pane local-to-remote and remote-to-local paste queues normal transfers; cut deletes the original only after the transfer completes successfully. Remote-to-remote paste is not a server-side copy operation.

Tutorial targets: `sftp.upload`, `sftp.download`, `sftp.terminal`.

Each transfer flows through this lifecycle, reflected in the transfer-activity list (per-row state labels `sftp.transferState.queued` / `active` / `done` / `failed` / `canceled`):

`sftp.queued` → `sftp.preparing` → `sftp.waiting` → in-progress (with bytes/percent) → `sftp.done` / `sftp.failed` / `sftp.canceled`.

Per-transfer controls:

- Cancel: `sftp.cancelTransfer` / `sftp.cancelTransferName`, in-flight `sftp.canceling`, post-state `sftp.canceledBeforeStart` or `sftp.transferCanceled`.
- Skip existing target: `sftp.skippedExisting`.

For transfer integrity, KKTerm disables SSH compression inside native SFTP Sessions even when compression is enabled for the parent SSH Connection; the SSH terminal continues to use its configured compression setting. KKTerm sends one SFTP write at a time and waits for its acknowledgement. Canceling an in-flight transfer or reaching its I/O timeout closes the affected SFTP Session and reconnects before the next queued transfer starts. The interrupted transfer is not retried automatically. If the remote protocol stream had already stopped responding, a partial upload may remain because KKTerm does not issue cleanup commands through the unusable Session.

## SFTP Debug Logging

Debug builds write SFTP startup and transfer records to `sftp.debug.log` beside `kkterm.log`. Release builds write the same JSONL log only when Settings → General → Debug → `settings.advancedDebugging` is enabled. Records include SFTP browser startup stages, requested and effective compression, per-session operation waits, transfer start/completion/error summaries, upload open/write/shutdown timeouts, Session invalidation and close results, and whether KKTerm removed a newly-created partial remote file or skipped cleanup because the Session was unusable. The log omits passwords, SSH key passphrases, terminal contents, and file contents, but it may include remote hostnames, usernames, local paths, and remote paths, so users should review it before sharing.

## Conflict resolution

When a transfer would overwrite an existing target, KKTerm shows an app-owned dialog (`sftp.transferConflict`):

- Target-exists copy: `sftp.targetExists`, detail `sftp.targetExistsDetail`.
- Per-direction variants: `sftp.uploadConflict`, `sftp.downloadConflict`. Generic existence labels: `sftp.folderExists`, `sftp.fileExists`.
- Actions: `sftp.skip`, `sftp.overwrite`, `sftp.overwriteAll`.
- More-conflicts indicator: `sftp.moreConflicts`, `sftp.moreConflictsDetail`.
- Cancel from inside the conflict prompt: `sftp.cancelTransferConflict`.
- Resolution status during wait: `sftp.waitingToOverwrite`.

## Context menu

Right-click an item for: transfer (`sftp.upload` / `sftp.download`, hidden in File Explorer), Open (`common.open`, single file selection), Cut (`common.cut`), Copy (`common.copy`), Paste (`common.paste`, also available from empty pane space), Rename (`sftp.renameItem`, single mutable local or remote selection), Copy Path (`sftp.copyPath`, copies the item's full path to the clipboard), Delete (`sftp.deleteLabel`, mutable local or remote selections), Select Left Side for Compare / Compare to (`compare.selectLeft` / `compare.compareTo`, single file — or single local folder — selection; see File Compare and Folder Compare below), and Get Info (`sftp.getInfo`, opens properties). File Explorer's local Open action follows Settings -> Workspace -> `settings.fileExplorerOpenMode`: `settings.fileExplorerOpenModeExternal` opens through the OS default app, while `settings.fileExplorerOpenModeInlineEditor` opens the file in KKTerm's inline Document/light editor. When `settings.hideTopTabButtons` is enabled, those inline Documents are File Explorer child rows instead of standalone Activity Rail entries. This is a native Tauri menu so it stays above adjacent URL and RDP native surfaces in split layouts.

## File Compare

Compare any two files with the two-step "select left, then compare" workflow shared by the File Explorer and SFTP/FTP browser. Right-click a single file and choose `compare.selectLeft` to remember it as the left side; a Status Bar confirmation (`compare.leftSelected`) acknowledges the choice. The remembered left file is **app-global**, so the next step can come from a different pane, Tab, or SFTP session. Right-click a second file and choose `compare.compareTo` (which shows the remembered file's name) to open the comparison overlay; the same `compare.selectLeft` item is still present to re-pick the left file. The item is shown only for a single selected file and hides when it would compare a file with itself.

Comparing a **remote** file downloads it to a temporary staging directory at selection time (so a later comparison never depends on the SFTP session staying open); local files are read in place. The overlay (`compare.title`) is an app-window overlay portalled above the workspace, like the Git Browser, and shows the two file names separated by `compare.versus` plus a mode switch (`compare.modeLabel`):

- **Text** (`compare.mode.text`) — a side-by-side line diff with the same search, all/diff/same filter, change navigation, and minimap as the Git Browser's advanced diff. The **Differences** and **Same** filters work the Beyond Compare way: instead of dropping the other rows, each contiguous hidden run collapses into one clickable `git.filteredLines` divider ("{{count}} filtered lines — click to expand"); clicking it (`git-adv-fold`) reveals that run in place, with an accented `git-adv-fold-open` header above it (`git.collapseLines`) to fold it back. So Differences mode shows changes with the matching sections folded away, and Same mode shows the identical sections with the differing runs folded — each expandable and re-collapsible on demand. Modified line pairs get Beyond Compare-style **per-character highlighting**: a character-level diff (shared prefix/suffix trim plus an LCS over the differing middle) marks the row `mod-pair` so it stays clean — a faint neutral line wash and a muted line-number gutter rather than a full red/green fill — and paints only the differing character runs in a red block with red text (`.seg-diff`) on both sides, leaving the unchanged runs in normal text. Pure add/del lines (present on only one side, no character segments) keep their solid green/red fill.
- **Image** (`compare.mode.image`, only when both files are images) — the two images (`compare.imageLeft` / `compare.imageRight`) plus a computed `compare.heatmap` whose `compare.tolerance` slider suppresses small per-pixel differences; `compare.differingPixels` reports the share of differing pixels.
- **Hex** (`compare.mode.hex`) — a side-by-side hexadecimal byte view (`compare.hexOffset`) that highlights every differing byte; `compare.hexTruncated` is shown when a large file is only partially loaded.

Text and Hex are always available; the default mode is auto-detected from both files (both images → Image, both text → Text, otherwise Hex).

## Folder Compare

Selecting a **folder** as the left side and choosing `compare.compareTo` on a second folder opens **Folder Compare** (`compare.folderTitle`) instead of the file overlay — a Beyond Compare-style two-pane directory diff. Both sides must be **local** folders: Folder Compare recursively reads and mirrors local paths, so picking a remote folder is rejected with `compare.folderRemoteUnsupported`, and selecting one file and one folder reports `compare.mismatch`.

The backend `compare_folders` command walks both trees and aligns entries by relative path, classifying each as **same**, **different** (byte-exact content comparison — equal size then a streamed chunk compare; files larger than 64 MB fall back to a modification-time check so the scan stays bounded), **left-only**, or **right-only**; a folder row is "different" when any descendant differs or exists on only one side. The walk stops after 200,000 aligned entries and the result is flagged truncated (`compare.folderTruncated`) so a pathological tree can't run unbounded. The header shows per-status counts (`compare.folderCountDifferent` / `compare.folderCountLeftOnly` / `compare.folderCountRightOnly` / `compare.folderCountSame`) and an All/Differences/Same filter reusing the diff `git.diffMode.*` labels. The row list is virtualized (only the rows in view are rendered), so large trees stay responsive — notably on macOS, where the WebKit webview would otherwise freeze building tens of thousands of rows.

From the tree you can:

- **Expand / collapse** folders (`compare.folderExpand` / `compare.folderCollapse`); double-clicking a folder toggles it.
- **Mirror** the selected (or hovered) entry to the other side — `compare.folderCopyToRight` / `compare.folderCopyToLeft` (backend `copy_local_path_to`, which creates missing parent folders and overwrites/merges). A `compare.folderCopied` Status Bar notice confirms.
- **Delete** the selected entry from one side (`compare.folderDelete`) after an inline confirmation (`compare.folderDeleteConfirm`); a `compare.folderDeleted` notice confirms.
- **Rescan** both folders (`compare.folderRefresh`); every copy/delete also re-runs the comparison.
- **Open a differing file pair** in the File Compare overlay above by double-clicking a file row present on both sides.

## Properties / chmod / chown

Open via the context menu's Get Info (`sftp.getInfo`). Dialog `sftp.sftpProperties`. Fields:

- `sftp.type` (`sftp.fileTypeLabel`), `sftp.size`, `sftp.modified`, `sftp.accessed`
- `sftp.owner`, `sftp.group`
- `sftp.mode` — change with `sftp.chmod`. Help: `sftp.modeHint`.
- Numeric UID / GID change: `sftp.chownUid`, `sftp.chownGid`. Validation: `sftp.ownerMustBeNumber`, `sftp.groupMustBeNumber`.
- Save: `sftp.save`.

Item-kind labels for selection and properties: `sftp.folder`, `sftp.file`, `sftp.symlink`. Generic delete-button label: `sftp.deleteLabel`. Transfer labels in summaries: `sftp.transfer`, `sftp.transferUpload`, `sftp.transferDownload`. External file fallthrough indicator: `sftp.extFile`.

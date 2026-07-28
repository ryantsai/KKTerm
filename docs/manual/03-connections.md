# 03 — Connections

## AI grep hints

- Keys: `connections.*` (full namespace), `app.connectionRail`
- Topics: Connection Tree, Child Connection Tabs, folders, search, Quick Connect, Add Connection, tutorial targets `connections.panel`, `connections.search`, `connections.quickConnect`, `connections.addConnection`, `connections.folderControls`, `connections.tree`, rename, delete, duplicate, pin to rail, drag/drop, properties dialog, icon image, icon foreground, icon background, Connection Tree keyboard shortcuts, F2 rename, Delete key
- Synonyms: "rename connection with keyboard", "F2 rename", "press delete to remove connection", "delete key connection tree", "keyboard rename", "remove connection shortcut"
- Synonyms: "child tab", "connection tree tab", "saved tab", "named tab under a connection", "sub tab"
- Synonyms: "saved host", "profile", "ssh entry", "create folder", "favourites", "icon color", "connection color"

> **Term:** "Connection" is the canonical name for a durable openable resource. Do not use "profile", "host entry", or "saved session". A Connection only becomes a live **Session** when opened; switching Tabs does not end the Session.

## Connection kinds

| Kind | i18n label | Notes |
|------|------------|-------|
| Local terminal | `connections.localShell` | Local PTY (ConPTY/`portable_pty`). |
| SSH terminal | `connections.secureShell`, type label `connections.ssh` | Backed by the `NativeSsh` transport. May persist tmux launch prefs. |
| Telnet | `connections.telnetShell`, type label `connections.telnet` | Password terminal. |
| Serial | `connections.serialLine`, type label `connections.serial` | Serial line. The `connections.line` field is an editable combobox: type a device path, or use the chevron button (`connections.serialLineDetect`) to open a list of OS-detected ports (`list_serial_ports` — macOS `/dev/cu.*`, Linux `/dev/tty*`, Windows `COM*`). The list re-scans each time it opens (catches hot-plugged devices) and shows `connections.serialLineNoneDetected` when empty. It defaults to the first detected port, falling back to a platform-appropriate example. A custom control is used instead of a native `<datalist>` because WKWebView (macOS) renders no dropdown affordance for it. |
| URL | `connections.embeddedWebApp` | Embedded WebView2 overlay window. See [08-url-webview.md](08-url-webview.md). |
| RDP | `connections.windowsRdp` | Windows native via mstscax; in-app IronRDP client on macOS/Linux. See [09-remote-desktop.md](09-remote-desktop.md). |
| VNC | `connections.screenControl` | RFB through `vnc-rs`. |
| FTP/FTPS | `connections.ftp` | Standalone file-transfer Connection routed through the SFTP/FTP browser surface. |
| Document | `connections.fileView` | Opens a single local file in the universal viewer / light editor (`FileViewerWorkspace`, tab kind `fileViewer`). No remote host or network Session. |

SFTP is not a standalone Connection kind — it is opened from an SSH Connection (`terminal.openSftp`, `terminal.sftp`).

The Document opens one local file and routes it to a mode by extension plus a backend magic-byte/text probe: text/code (CodeMirror), Markdown, table (CSV/TSV), JSON, image, a dedicated Log mode (`workspace.fileViewer.kind.log`) with a parser dropdown (`workspace.fileViewer.parser` / `workspace.fileViewer.parserType.*`), level chips (`workspace.fileViewer.level.*`), a line filter, ANSI coloring, and a follow/tail toggle (`workspace.fileViewer.follow`), and a Hex fallback. The Hex fallback decodes its bounded binary preview away from the app UI thread and renders only the visible fixed-height row window, keeping larger previews responsive. The Log parser dropdown can auto-detect common signatures or force generic text, JSON/JSONL, logfmt, Syslog, HTTP access logs, Windows event exports, Java stack traces, or container runtime prefixes. The toolbar mode switch (`workspace.fileViewer.kind.*`) lets the user re-pick the mode; Text and Hex are always offered as fallbacks. Unsupported document containers such as Office files show an unsupported page (`workspace.fileViewer.unsupportedTitle`) instead of immediately opening as Hex; the user can choose `workspace.fileViewer.openAsText`, `workspace.fileViewer.openAsBinary`, or `workspace.fileViewer.openExternalEditor`.

The text/code mode is a light editor (`workspace.fileViewer.save`, also Ctrl/Cmd+S): a modified dot marks unsaved changes, and saving writes atomically (temp file + rename) with an mtime conflict check — if the file changed on disk since it was opened, the editor confirms before overwriting (`workspace.fileViewer.saveConflictConfirm`). Editing is only offered for whole, cleanly-decoded UTF-8 text; large or non-UTF-8 files stay read-only. A large text file is still completely navigable: KKTerm builds a sparse line index in a background worker, maps the scrollbar across every line, lazily reads only nearby 256-line pages, renders only the visible rows, and keeps a small page cache instead of placing the whole file in frontend memory. Switching mode or reloading with unsaved edits prompts to discard (`workspace.fileViewer.discardConfirm`).

PDF (`workspace.fileViewer.kind.pdf`) renders through an external dependency that is downloaded on demand rather than bundled: the `poppler` Install Helper recipe. When a PDF is opened and the renderer is missing, the viewer shows an install gate (`workspace.fileViewer.dependencyNeededTitle`) with an in-context **Install Poppler** button (Windows, via the Install Helper) or, on other platforms, a hint to install Poppler on `PATH` (`workspace.fileViewer.dependencyManualHint`); after install, the page renderer mounts with page navigation and zoom.

## Connections Panel UI

Header row (top of the panel):

- Title: `connections.title`
- Add Connection: `connections.addConnection`, tutorial target `connections.addConnection`
- Quick Connect: `connections.quickConnect`
- New Folder: `connections.newFolder`
- Collapse / Expand all: `connections.collapseAll`, `connections.expandAll`
- Show Connected: `connections.showConnected`; filters the Connection Tree to only connections that currently have a live session, pruning empty folders. Shows the button in its pressed state while enabled; the filter is session-only and is not persisted across app relaunches. It composes with Hide Folders. While a search query is active the search takes precedence: matching connections are surfaced even when they are not currently connected, so you can always find a connection by name regardless of the toggle.
- Hide Folders: `connections.hideFolders` (formerly "Show All"); flattens the Connection Tree across folders into a single de-duplicated list while preserving the existing Connection order, shows the button in its pressed state while enabled, and persists the preference in the Settings database across app relaunches.
- Search box: placeholder `connections.searchPlaceholder`. While a search is active, matching folders are shown expanded so nested result rows are immediately visible; clearing search restores the folder collapse/expand state from before the search.
- Column toggle: custom title-bar `app.connections` icon or Workspace icon on the Activity Rail

Tree accessible label: `connections.connectionTree`. Expand/collapse chevrons use `connections.expand` / `connections.collapse`.

Tutorial targets: `connections.panel`, `connections.search`, `connections.quickConnect`, `connections.addConnection`, `connections.folderControls`, `connections.tree`.

## Right-click context menu (native Tauri menu)

Driven by `src/lib/nativeContextMenu.ts`. On a Connection or folder node:

- `connections.newConnection`
- `connections.newSubfolderIn` (when the right-clicked node is a folder)
- `connections.rename`, dialogs `connections.renameFolder` / `connections.renameConnection`
- `connections.changeIcon` on folder rows opens the shared icon picker for the folder icon.
- `connections.duplicate` on Connection rows opens a Connection Properties draft populated from the selected Connection and named with the next available `#N` suffix (for example, `Bastion#2`). The durable deep copy is created only when Save is pressed; Cancel leaves the tree unchanged. Non-secret Connection configuration is copied, while secret values remain in the credential store and must be selected or entered in the draft when needed.
- `connections.panoramaView` opens every Connection in the active Workspace root as one panorama, reusing live Sessions. Folder-only controls are hidden when the tree has no folders. When the action would start more than ten new Sessions, `connections.openPanoramaConfirmTitle` / `connections.openPanoramaConfirmBody` ask for confirmation before `connections.openPanoramaConfirmAction` proceeds; already-open Sessions are excluded from that count.
- `connections.openAllInFolder` on folder rows is a submenu that opens every Connection inside the folder, child folders included. Connections that already have an open Tab or Pane keep and reuse that live Session instead of reconnecting. `connections.openAllInTabs` opens each remaining Connection in its own Tab through the standard open path (so per-type handling applies); `connections.openAllInPanorama` lays the remaining unopened Connections out as split Panes inside a single Tab, the same grid a parent Connection uses for multiple Child Connections. The same over-ten confirmation applies to the Panorama branch. The submenu is disabled when the folder holds no Connections.
- `connections.closeAllInFolder` on folder rows closes every open Tab and Pane for every Connection inside the folder, child folders included — the folder-wide counterpart of `connections.closeConnection`. It is disabled when nothing in the folder is currently open and does not delete the Connections.
- `connections.delete`, immediately below Duplicate on Connection rows, with confirmation copy `connections.deleteFolderConfirm` or `connections.deleteConnectionConfirm` and caveat `connections.cannotBeUndone`. Deleting a Connection also closes any open Tab or Pane for that Connection.
- Pin to rail: `connections.pinToRail` / `connections.unpinFromRail`. Status: `connections.pinnedToRailStatus`, `connections.unpinnedFromRailStatus`. Error: `connections.pinRailError`.
- `connections.closeConnection`, shown while the Connection has one or more open Sessions (including the local live markers held by open File Explorer and Document Tabs). It closes every open Tab and Pane for that Connection. An open SSH or Telnet Pane also shows `connections.reconnect`, whether its Session is connected or disconnected, and restarts the Session in the existing Pane. An idle Connection that has not been opened shows neither action.
- Top-level `workspace.newTab` on Connection rows. This opens the same new Tab flow as the Add-to-folder `workspace.newTab` entry and remains available in both places.
- Add to folder: `connections.addTo`, including `workspace.newTab` with shortcut hint `connections.newTabShortcut`, then pane placement directions `connections.left`, `connections.right`, `connections.lower`, `connections.upper`. When `settings.hideTopTabButtons` is enabled for a terminal parent, the pane placement directions create a Child Connection Tab and dock it in the active parent panorama.
- Layout for terminal and URL Connections: `connections.layout` with `common.save` / `common.reset` to persist or clear saved split Pane layout for that Connection.
- `connections.properties`

Icons are rasterized to 16 px PNG bytes via `src/lib/nativeContextMenu.ts`. Do not pass raw SVG paths to Tauri menu APIs.

## Connection Tree keyboard shortcuts

When the Connection Tree has keyboard focus, two shortcuts act on the Connection row that is focused (falling back to the currently selected Connection):

- **F2** starts an inline rename on that Connection — the same inline editor as the context-menu `connections.rename`, committing on Enter and cancelling on Escape. F2 is the rename key on every platform (Enter keeps opening the focused Connection); on macOS press Fn+F2, or enable "Use F1, F2, etc. keys as standard function keys".
- **Delete** removes that Connection through the shared confirm-then-delete flow (native confirmation dialog, or the in-app fallback), the same path and `connections.deleteConnectionConfirm` / `connections.cannotBeUndone` copy as the context-menu `connections.delete`. On macOS, **Backspace** and **Command+Backspace** also delete, because the key Mac keyboards label "delete" is Backspace and Finder's Move to Trash is Command+Delete.

The handler is bound to the tree container, so it fires only while the tree itself holds focus: a Delete keypress in a terminal Pane, the tree search field, or an active rename input is never intercepted, and folders and Child Connection Tabs keep their existing context-menu rename/delete. With the default single-click-opens-Connection behavior, clicking a Connection opens it and moves focus into the opened Pane; select without opening (for example in `settings.doubleClickOpensConnection` mode) or Tab into the tree to keep focus on a row for these keys. Both actions are always available and are not part of the customizable Settings → Shortcuts list.

## Child Connection Tabs

A **Child Connection Tab** is a saved Tab entry shown as an italic child row below its parent terminal-type Connection when `settings.hideTopTabButtons` is enabled. It is a Workspace presentation/reopen record, not a nested durable Connection. The parent Connection still owns host, protocol, credential metadata, and folder placement.

Child rows appear only once a parent has two or more children. A parent with a single child shows no child row at all: the parent row itself represents that one child and carries its live green status LED. Adding a second child (for example, Add Tab on the parent) expands the parent into its child rows, the first being the original child.

New Tabs opened from local terminal, SSH, Telnet, or Serial Connections become Child Connection Tabs in this mode; non-terminal Connections disable the Add Tab action. Files opened from a File Explorer Connection with `settings.fileExplorerOpenModeInlineEditor` also become Document child rows under that File Explorer parent, so hidden top Tabs do not leave the inline Document reachable only through the Activity Rail. They belong to the Workspace that opened them; switching Workspaces hides child rows and open child-tab locations from other Workspaces without closing those live Sessions. They persist across app launches but open lazily: KKTerm starts the live Session only when the user selects the child row. Right-clicking a child row offers `connections.rename` and `connections.properties`; the properties dialog title is `connections.childConnectionProperties` and edits the child Tab name, icon image, icon foreground, and icon background without changing the parent Connection. Terminal font size, transparency, and background changes made from the child Pane toolbar are also stored on the Child Connection Tab, not on the parent Connection.

Clicking a parent Connection with Child Connection Tabs opens all of its active Workspace children together in one split workspace Tab when none of those children are already live. If the parent has no children yet, KKTerm creates the first Child Connection Tab and shows it instead of opening the parent as a standalone Session. If a child Tab for the active Workspace is already open, KKTerm focuses the existing child Tab/Pane instead of reconnecting. If the parent split layout is already live, returning to the parent Connection restores the last focused child Pane in that panorama while showing the full split layout and preserving the live split arrangement. The parent row alone is highlighted for the full panorama; child rows highlight only when a specific child Pane is opened as the maximized child view.

## Add Connection / Quick Connect dialogs

Both are app-owned DOM dialogs (not browser-native `prompt`).

Connection and Quick Connect text fields that collect technical values — hosts,
ports, usernames, passwords, key paths, serial lines, local directories, URLs,
and URL credential metadata — disable OS spelling autocorrect, capitalization,
and spellcheck in the app WebView on Windows and macOS. Keyboard/IME suggestion
UI supplied outside the WebView may still appear.

**Quick Connect** (`connections.quickConnectDialog`) is a fast path that **persists** a saved Connection and opens it — it is no longer an unsaved one-off. Before creating SSH targets, it reuses an identical existing Connection matched by host/user/port; local shell targets always create a new saved Connection, adding `#1`, `#2`, and so on when the shell name already exists. Other non-SSH targets create a new Connection at the tree root. A password typed on a reused target updates that Connection's stored credential. The full Quick Connect dialog reflects this: subtitle `connections.openOneOffSession` and primary button `connections.saveAndConnect`. Fields shown depend on the chosen kind:

- Hostname (`connections.hostname`, placeholder `connections.exampleHost`)
- Port (`connections.port`)
- Save & connect button (`connections.saveAndConnect`), Cancel (`connections.cancel`).
- Permission tier toggle: `connections.normal` / `connections.admin`. The native compact local-shell menu shows elevated-capable shells as flat first-level choices, with the `connections.normal` variant before `connections.admin`.
- Recently used Connections list: the native compact menu shows the five newest saved recent Connections directly, then `connections.moreRecent` for older records up to 20 total. Empty state: `connections.noRecent`.

Opening a saved Connection or Quick Connect starts the live Session asynchronously. If a remote host is unreachable, host-key verification or startup can fail in the target Tab, but the Activity Rail, Connection Tree, Settings, and other open Tabs should remain usable while the attempt is pending.

For local Command Prompt and PowerShell Quick Connect entries, `connections.admin`
depends on how KKTerm itself is running. If KKTerm is already elevated, the
admin shell opens as an embedded local terminal Session and is **persisted** as a
saved local Connection (reuse-or-create, matched by shell). If KKTerm is not
elevated, KKTerm launches an external elevated Command Prompt or PowerShell
process through the Windows UAC path; that external process has no in-app Session
and is **not** saved.

**Add Connection** uses the same form shape but persists to SQLite. The Type selector label is `connections.type`.

The Add Connection browser's `connections.import.tileTitle` entry opens the batch `connections.import.title` dialog. Its `connections.import.fromFileTitle` tab accepts CSV/TSV/text, OpenSSH config (`~/.ssh/config`, `%USERPROFILE%\.ssh\config`, or equivalent content under another filename), RDCMan `.rdg`, MobaXterm `.mxtsessions`, and PuTTY `.reg`. An OpenSSH config produces one editable, initially selected preview row per concrete Host alias; wildcard-only Host sections supply inherited defaults but do not create rows. `IdentityFile` and `ProxyJump` survive the preview and are saved on imported SSH Connections. Unsupported SSH directives appear under `connections.import.warningsHeading`. Users may select any subset before the primary `connections.import.importCount` action creates the Connections in the chosen Workspace.

When Add Connection, Quick Connect, or Connection Properties needs to write a
password while encrypted database storage is locked, KKTerm opens the encrypted
database unlock dialog before changing the durable Connection. A successful
unlock resumes the original Save automatically. Cancel leaves the form and the
existing Connection data unchanged; the backend lock message is not shown as a
Connection form-validation error.

Local terminal Add/Edit Connection uses the `connections.shell` tabbed selector for the local shell choice and still stores the selected `localShell` value on the Connection.

RDP Add/Edit Connection can inherit its administrative-session and local-resource choices from Settings or override them for that Connection. `settings.rdpAdministrativeSession` remains off by default and requests a server administration session; it does not elevate the selected account. Redirection also remains off by default. On Windows, enabling it initially redirects all local drives and `settings.rdpChooseDrives` opens a Sheet for choosing all drives or a selected subset; a temporarily unavailable saved drive remains visible and selected through `settings.rdpUnavailableDrive`. On macOS and Linux, `settings.rdpAddFolder` can add multiple folders, each exposed by IronRDP as a separate redirected drive; the Windows drive selector is not shown.

Beside `connections.localStartupScript`, the wand action
`connections.cliAccountAlternateProfileHint` opens the guided
`connections.cliAccountHelper` dialog for a Claude Code or Codex alternate
account. The account label is editable and previously applied labels are
remembered locally for reuse. Applying records `CLAUDE_CONFIG_DIR` or
`CODEX_HOME` in a marked, shell-appropriate Startup script block. At launch,
KKTerm extracts that managed value, creates the stable per-user account
directory, and adds the variable to the terminal process environment before the
shell starts; it does not type the setup block through the interactive prompt.
Commands outside the marked block remain unchanged and still run as normal
Startup script commands. Changing the selected shell rewrites only the managed
block into the new shell's syntax. The user signs in normally after opening the
terminal; KKTerm never asks for or stores the CLI's API keys, OAuth tokens, or
passwords.

Each account directory isolates the selected CLI's broader local state as well
as authentication, so settings, history/sessions, memory, and tool configuration
may also differ between account Connections. Keep the generated directory stable
after login. Current Claude Code CLI releases namespace macOS Keychain entries by
the `CLAUDE_CONFIG_DIR` path; if macOS profiles collide or repeatedly lose their
login, update Claude Code before recreating the account Connection. OpenCode is
not offered because its documented config-directory override does not document
isolating its credential store.

File Explorer Add/Edit Connection uses `connections.localFilesRootDirectory` for the optional starting folder. On creation, leaving the starting folder at its default home-folder behavior, or explicitly choosing the detected home folder, uses the localized `connections.homeDirectory` Connection name. Choosing or typing a different starting folder means the folder name becomes the default Connection name unless the user enters an explicit name.

Document Add/Edit Connection uses `connections.fileViewPath` for the target file, picked through a native open-file dialog (`connections.fileViewPickerTitle`). The file's base name becomes the default Connection name unless the user enters an explicit name. The path is stored in the Connection's `local_startup_directory` slot (reused as the file path). The per-Connection option `connections.fileViewOpenExternal` opens that saved Document through the operating system's default app instead of creating a KKTerm Tab; its hint is `connections.fileViewOpenExternalHint`.

Once opened, the Document viewer (`FileViewerWorkspace`) presents a single toolbar — a file-type glyph, the file name, a colored kind pill, and per-mode controls — over the viewer body. The toolbar ends with a `common.close` button, shown for the Document Tab whenever `settings.hideTopTabButtons` hides the top Tab Strip's per-Tab close. The active Document has no footer of its own: its centered status (kind label, file size, per-mode facts, the decode encoding, and the editable-state badge `workspace.fileViewer.readOnly` / `workspace.fileViewer.saved` / `workspace.fileViewer.unsaved`) is shown in the app's global Status Bar, the single status surface. Per-mode surfaces include a collapsible JSON tree (`workspace.fileViewer.expandAll` / `workspace.fileViewer.collapseAll`), Markdown Preview / Split / Source views (`workspace.fileViewer.view.*`), a sortable table grid for CSV/TSV, log parser and severity filters with follow/tail, and image zoom / fit / rotate. Image/SVG and PDF modes also expose a hamburger button (`workspace.fileViewer.viewOptions`) with a Background option (`workspace.fileViewer.background`) that opens the shared background picker; default mode uses `workspace.fileViewer.backgroundDefaultHint`, and the selected background persists per Document Connection across app launches. The PDF mode still gates on the on-demand renderer add-on via the Install Helper.

A file with an unrecognized extension opens as editable text (the Text/Code editor), not a read-only viewer; only recognized binary containers (archives, databases) fall back to the read-only Hex view. Hex stays reachable from the mode switcher, and binary content opened as text stays read-only.

For text-based modes the compact icon bar provides Save, undo/redo, cut/copy/paste, search, soft wrap (`workspace.fileViewer.softWrap`), line numbers (`workspace.fileViewer.lineNumbers`), visible whitespace (`workspace.fileViewer.showWhitespace`), Markdown folding/comment controls, indentation, and Compare with File (`workspace.fileViewer.compareWithFile`). New File and Open File are intentionally absent because a Document always enters through Add Connection or the file browser. Activating Search (`workspace.fileViewer.find`) is the only action that reveals the search/replace strip; it supports previous/next results, case-sensitive, whole-word, and regular-expression matching plus Replace and Replace All. The global Status Bar shows the one-based caret line/column (`workspace.fileViewer.lineColumn`) and selected-character count (`workspace.fileViewer.selectionCount`). The Font & Encoding menu remains at the right end of the toolbar.

Soft wrap defaults on so long lines stay inside the Document body; its pressed state is remembered per Connection for the current app session in `sessionStorage`, not in the SQLite Connection model. Font family and size apply live to the text. Encoding defaults to Auto (`workspace.fileViewer.encodingAuto`); the backend auto-detects the charset and shows the resolved encoding (`workspace.fileViewer.encodingDetected`), or the user can force a specific encoding (UTF-8, GBK, Shift_JIS, …), which reloads the file. Saving always writes UTF-8, so a non-UTF-8 file is read-only to avoid silently transcoding it. Font, size, and encoding are remembered per Connection in `localStorage` and restored the next time that Document opens.

Files beyond the editable text cap open in the read-only large-text viewer instead of crossing the Tauri bridge as one giant string. The backend streams the file once to build sparse line checkpoints while `workspace.fileViewer.indexingLargeFile` is visible; the prefix remains readable during that work. After `workspace.fileViewer.largeFileIndexed` appears, the scrollbar covers the complete file and `workspace.fileViewer.goToLine` jumps to any exact line. Nearby 256-line pages are fetched on demand and a bounded 12-page cache keeps scrolling fast without retaining the whole file in frontend memory. Large-file mode deliberately skips editing, full-document syntax styling, and search/replace.

SSH Add/Edit Connection uses the `connections.auth` tabbed selector for authentication method choices: `connections.keyFile`, `connections.password`, and `connections.sshAgent`. FTP Add/Edit Connection shows the same selector only when `connections.ftpProtocolSftp` is selected in `connections.ftpProtocol`; choosing `connections.ftpProtocolFtps` or `connections.ftpProtocolFtp` keeps the authentication area password-only.

The FTP options panel also carries two per-Connection start folders for the dual-pane browser: `connections.ftpLocalPath` (with a `connections.browse` folder picker titled `connections.ftpLocalPathPickerTitle`; Add Connection prefills it with the actual home directory, and an empty value means the home directory, `connections.ftpLocalPathPlaceholder`) and `connections.ftpRemotePath` (empty by default; an empty value means the server's default directory, `connections.ftpRemotePathPlaceholder`).

For SSH (password auth) and Telnet Connections the password is optional: the field is not required and its placeholder is `connections.passwordOptionalHint`. Leaving it blank stores no credential, and KKTerm answers the remote login prompt interactively in the terminal on every connect. When a stored password is rejected (wrong password), the connect falls back to the same in-terminal prompt so the user can re-enter it. Typing a password stores it in the selected credential backend and uses it automatically.

For SSH, Telnet, RDP, VNC, and FTP Connections, the password area can reuse saved Connection password credentials (Saved Credentials) from the same Connection type. When at least one matching Saved Credential exists, the password area shows an explicit mode switch: `connections.enterNewPassword` renders the password field, and `connections.useSavedCredential` renders the `connections.savedPassword` dropdown whose options show each credential's user-editable label. Only the active mode is submitted, so a typed password can never silently discard a dropdown selection. Typing a password stores it as a credential in the selected backend; when an existing same-type credential with the same username already stores that exact password, KKTerm links the Connection to it instead of creating a duplicate. Editing a Connection that already links to a Saved Credential and typing a new password asks what to do (`connections.sharedCredentialUpdateTitle`): `connections.sharedCredentialUpdateShared` rotates the shared credential's password so every linked Connection uses it, while `connections.sharedCredentialCreateSeparate` creates a new credential for this Connection only. Saved Credentials are renamed and managed centrally in Settings → Credentials (see chapter 15).

For saved Connections, the properties/Add Connection header includes Connection icon presentation controls. `connections.editIcon` changes the icon image through default protocol icons, Reicon line-icon choices, Material icon choices, bundled OS/Linux-distribution logos, bundled coding-tool and terminal logos, saved images, or a newly chosen image. The picker search placeholder is `common.searchForMore` because the initial grid shows only a bounded subset of the bundled icon catalog. The coding-tool and terminal logos cover common AI coding tools (OpenAI Codex, Claude Code, OpenCode, Cursor, GitHub Copilot, Windsurf, Codeium, Gemini CLI, Google Antigravity, Visual Studio Code) plus shell/terminal identities (GNU Bash, Zsh, fish shell, PowerShell, Windows Terminal, WSL, iTerm2, WezTerm, Alacritty, tmux). The picker also includes one choice for every distinct artwork bundled with the Install Helper. Product names and English semantic terms remain searchable in every UI language, while equivalent terms in the active local language map to the same results. The OS logos cover common Linux distributions (Ubuntu, Debian, Fedora, Red Hat, CentOS, AlmaLinux, Rocky, openSUSE/SUSE, Arch, Alpine, Mint, Kali, Gentoo, and more), the BSDs (FreeBSD, OpenBSD, NetBSD), macOS and Windows, Raspberry Pi, and appliance platforms (Proxmox VE, TrueNAS, pfSense, OpenWrt). They are searchable in the picker by distribution/product name or keywords such as `linux`, `rhel`, `bsd`, `nas`, `router`, `ai`, `coding`, `shell`, or `terminal`. The foreground palette lives inside the `connections.editIcon` selector popover and appears only when the selected glyph is a recolorable Reicon/Lucide fallback glyph. `connections.iconForeground` labels that palette; `connections.defaultIconForeground` clears a custom foreground color, and `connections.selectIconForeground` applies a palette color to the Reicon/Lucide fallback SVG icon strokes. PNG, Material, OS, brand, saved-image, and chosen-image icons keep the foreground palette hidden because they ignore the foreground color. `connections.editIconBackground` opens the icon background picker; `connections.iconBackground` labels the background row, `connections.transparentIconBackground` clears the color back to the default transparent state, and `connections.selectIconBackground` applies a palette color, including a visibly bounded white choice. The rainbow choice opens the shared `common.customColor` selector with a `common.hexColor` field. The chosen foreground/background presentation is shown behind Connection icons in the Connection Tree and on pinned/connected Activity Rail Connection shortcuts. Folder rows use the same picker through `connections.changeIcon`, storing the selected Material icon, Reicon icon, saved image, or chosen image on the folder. Workspace Tab rename is runtime-only Tab UI state and does not update the saved Connection `name`, icon, foreground/background presentation, or `tabTitle`.

### SSH remote-OS icon auto-detection

The first time an SSH Connection without a chosen icon opens a terminal Session, KKTerm runs a short, bounded remote probe and sets a matching distribution/OS logo as the Connection icon. The probe reads `/etc/os-release` and `uname -s` (so Linux distributions and the BSDs/macOS are recognized by kernel even without os-release), the device-tree hardware model (so 64-bit Raspberry Pi OS, which reports `ID=debian`, still gets the Raspberry Pi logo), and a few distinctive markers for appliance platforms that share a generic base OS (Proxmox VE via `/etc/pve`, TrueNAS, pfSense). The detected logo then appears wherever the Connection icon is shown, including the Connection Tree, Activity Rail shortcuts, and the top-left icon of the Tab/Pane toolbar. Detection is best-effort: a non-POSIX remote shell (for example a default Windows `cmd` exec shell) or an unrecognized distribution simply leaves the default SSH icon in place, and unknown Linux distributions fall back to a generic Linux (Tux) logo.

Auto-detection runs at most once per Connection: after the first established SSH probe attempt the Connection is flagged as detected (persisted across app restarts) and the remote host is not probed again, which keeps later connects fast. It also never overrides a hand-picked icon — deliberately choosing an icon through `connections.editIcon`, including resetting it back to the default through `common.reset`, opts the Connection out of auto-detection entirely. A Connection that already carries a custom icon chosen before this feature shipped is likewise left untouched. Child Connection Tabs without their own icon override inherit the parent Connection's detected icon.

## Drag and drop

Drag a Connection onto a folder to move it; drag onto another Connection to reorder. Folders can be nested: when dragging a folder over another folder, drop on the center of the row to make it a subfolder, or drop near the row edge to reorder it beside that folder. While a tree drag is active, a temporary `connections.root` drop target appears so Connections or folders can be moved back to the root even when the visible tree has no blank space. Order is persisted.

Dragging files or folders from an open File Explorer Connection pane (or the local side of an SFTP transfer) onto the Connection Tree creates Connections immediately with default settings, the same as Add Connection: a dropped file becomes a Document Connection (`connections.fileView`, named after the file), and a dropped folder becomes a File Explorer Connection (`connections.localFiles`, named after the folder's last path segment). The tree highlights while items are dragged over it, and multiple items can be dropped at once. (Dropping directly from the OS file manager is not supported: KKTerm runs with the webview's native drag-drop handler disabled so its in-app HTML5 drag-and-drop works on Windows, which means OS file drops never report a usable path.)

Dragging a Connection from the Connection Tree onto the Workspace Canvas creates a split Pane beside the hovered surface. Dock zones are available on terminal, File Explorer, Document, URL, RDP/VNC, FTP, and SFTP Tabs; dropping onto a standalone Tab converts it into the shared split-Pane layout with the original surface preserved as the first Pane. When `settings.hideTopTabButtons` is enabled for a terminal parent, dropping that parent into a dock zone creates and docks a new Child Connection Tab rather than an unnamed ephemeral Pane.

## Status badges

Each Connection in the tree shows a live status dot when it has one or more Sessions open. The dot is derived from `withLiveConnectionStatuses` in `src/modules/workspace/connections/treeUtils.ts` and is **display-only**. File Explorer (`localFiles`) and Document (`fileView`) Connections have no network Session, but each registers a local live marker the moment its Tab opens, so its tree dot turns active (green) while open and clears when the Tab closes. Do not pass the live-status Connection to workspace components that own Session lifecycle (TerminalWorkspace, WebViewWorkspace, RemoteDesktopWorkspace, SftpWorkspace) — they look up the stable Connection by id from the raw tree. See `src/modules/dashboard/widgets/ConnectionWidgetBody.tsx` for the safe pattern.

## Pinned Connections on the Activity Rail

Pinning a Connection (`connections.pinToRail`) adds it to the `app.connectedConnectionsRail` group on the Activity Rail. Pinned icons survive launches; status dots reflect live Sessions. Unpinning is reversible — Connections themselves are not affected.

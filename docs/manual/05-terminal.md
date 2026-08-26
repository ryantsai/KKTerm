# 05 — Terminal

## AI grep hints

- Keys: `terminal.actions`, `terminal.copy`, `terminal.copyShortcut`, `terminal.paste`, `terminal.pasteMultilineConfirm`, `terminal.find`, `terminal.findInScrollback`, `terminal.noResults`, `terminal.closeSearch`, `terminal.previousSearch`, `terminal.nextSearch`, `terminal.font`, `terminal.increaseSize`, `terminal.decreaseSize`, `terminal.resetSize`, `terminal.opacity`, `terminal.opacityValue`, `terminal.background`, `terminal.backgroundDefaultHint`, `terminal.appearanceSaveFailed`, `terminal.syntaxHighlight`, `terminal.syntaxHighlightNone`, `terminal.syntaxHighlightSaveFailed`, `terminal.save`, `terminal.saveBuffer`, `terminal.bufferSaveFailed`, `terminal.startRecording`, `terminal.stopRecording`, `terminal.recording`, `terminal.openRecordings`, `terminal.recordingsTitle`, `terminal.openRecordingsFolder`, `terminal.noRecordings`, `settings.autoRecordSessions`, `settings.autoRecordSessionsHint`, `settings.rightClickPaste`, `settings.rightClickPasteHint`, `settings.shortcutReconnectActiveSession`, `connections.reconnect`, `terminal.logFiles`, `terminal.textFiles`, `terminal.quickCommandsShow`, `terminal.quickCommandsHide`, `terminal.quickCommandsManage`, `terminal.quickCommandsLibrary`, `terminal.quickCommandsRequireConfirm`, `terminal.quickCommandLibrary`, `terminal.quickCommandsCustomCommand`, `terminal.quickCommandsGenerateWithAi`, `terminal.quickCommandsAiPromptLabel`, `terminal.quickCommandsAiPromptPlaceholder`, `terminal.quickCommandsNoPane`, `terminal.quickCommandBundlesTitle`, `terminal.quickCommandBundlesSubtitle`, `terminal.quickCommandBundlesEmpty`, `terminal.quickCommandBundleNone`, `terminal.quickCommandBundleNoneDesc`, `terminal.quickCommandBundleSwitch`, `terminal.quickCommandBundleCount_one`, `terminal.quickCommandBundleCount_other`, `terminal.quickCommandBundleNew`, `terminal.quickCommandBundleNewTitle`, `terminal.quickCommandBundleCreate`, `terminal.quickCommandBundleName`, `terminal.quickCommandBundleNamePlaceholder`, `terminal.quickCommandBundleCopyCurrent`, `terminal.quickCommandBundleRename`, `terminal.quickCommandBundleRenameTitle`, `terminal.quickCommandBundleEditCommands`, `terminal.quickCommandBundleDelete`, `terminal.quickCommandBundleDeleteTitle`, `terminal.quickCommandBundleDeleteMessage`, `terminal.quickCommandsBundleSubtitle`, `settings.quickCommandBundles`, `settings.quickCommandBundlesHint`, `terminal.starting`, `terminal.sessionFor`, `terminal.startingSessionFor`, `terminal.failedToStart`, `terminal.failedToStartDetail`, `terminal.desktopRuntimeRequired`, `terminal.tauriRequired`, `terminal.noSaveDialog`, `terminal.saveDialog`, `terminal.connectLabel`, `terminal.targetLabel`, `workspace.takeScreenshot`, `settings.submitAiAttachmentsDirectly`, `connections.wslDistribution`
- Recording browser keys: `terminal.recordingsCount`, `terminal.recordingsSearchPlaceholder`, `terminal.recordingsAllHosts`, `terminal.recordingsAnyDate`, `terminal.recordingsToday`, `terminal.recordingsLastSevenDays`, `terminal.recordingsName`, `terminal.recordingsType`, `terminal.recordingsTypeLocal`, `terminal.recordingsTypeSsh`, `terminal.recordingsTypeTelnet`, `terminal.recordingsTypeSerial`, `terminal.recordingsTypeUnknown`, `terminal.recordingsHost`, `terminal.recordingsDate`, `terminal.recordingsTime`, `terminal.recordingsDuration`, `terminal.recordingsSize`, `terminal.recordingsAiSummary`, `terminal.recordingsResizeDialog`, `terminal.recordingsEmpty`, `terminal.recordingsNoMatch`, `terminal.recordingsSelectAll`, `terminal.recordingsSelectOne`, `terminal.recordingsOpenBuiltInEditor`, `terminal.recordingsSelected`, `terminal.recordingsSummarize`, `terminal.recordingsSummarizing`, `terminal.recordingsGenerateSummary`, `terminal.recordingsRegenerateSummary`, `terminal.recordingsSummaryReady`, `terminal.recordingsSummariesReady`, `terminal.recordingsSummaryFailed`, `terminal.recordingsExportZip`, `terminal.recordingsExporting`, `terminal.recordingsExportDialogTitle`, `terminal.recordingsZipFiles`, `terminal.recordingsExported`, `terminal.recordingsExportFailed`, `terminal.recordingsLoadFailed`, `terminal.recordingsSearchFailed`, `terminal.recordingsFolderOpenFailed`
- Keys (WezTerm-inspired batch): `terminal.colorScheme`, `terminal.colorSchemeGlobalDefault`, `terminal.colorSchemeSaveFailed`, `terminal.quickSelect`, `terminal.quickSelectHint`, `terminal.quickSelectNoMatches`, `terminal.quickSelectCopied`, `terminal.notification`, `terminal.notificationWithTitle`
- Text encoding key: `terminal.textEncoding`
- Topics: terminal external links, copy/paste, multiline paste confirmation, find in scrollback, font size, Keyword Highlighting, Quick Command Bar, quick commands, Quick Command Bundles, save buffer to file, recording terminal output, starting state, quick select, prompt navigation, shell integration, inline images, terminal notifications, color schemes, tutorial targets `terminal.pane`, `terminal.startRecording`, `terminal.openSftp`, `terminal.copySelection`, `terminal.sendToAi`, `terminal.actions`, `terminal.searchBar`, `terminal.surface`
- Synonyms: "open link in browser", "external browser", "highlight text", "search terminal", "zoom terminal", "shrink font", "terminal opacity", "transparent terminal", "terminal wallpaper", "terminal background", "quick command bar", "quick command", "command shortcut", "quick command bundle", "command bundle", "shared command list", "command set", "switch bundle", "export log", "record session", "terminal recording", "transcript", "auto record", "auto archive", "session log", "audit log", "right-click paste", "putty paste", "copy url without mouse", "hint labels", "jump to previous command", "OSC 133", "sixel", "imgcat", "terminal theme", "dracula", "solarized"

## Rendering

Terminal Panes are rendered by xterm.js. Local terminals use ConPTY through `portable_pty`; SSH terminals use KKTerm's `NativeSsh` transport. Both run through the real Tauri runtime — a Vite browser preview cannot host them. Behaviour like focus and input must be validated against `npm run tauri dev` or the built `kkterm.exe`.

On macOS, IME key events remain under WebKit's composition lifecycle instead of being processed as terminal keys while composition is active. When composition ends, KKTerm sends the completed input to the Session once. If Apple Pinyin's marked text differs from the physical text only by IME-added syllable spacing, KKTerm preserves the physical spacing; user-typed spaces and conversions to different text remain unchanged. This avoids duplicate or altered input when Caps Lock switches between Chinese and English.

The terminal hamburger menu exposes `terminal.textEncoding` directly below Font for Local, SSH, Telnet, and Serial/COM Panes. UTF-8 is the default. The selected ASCII-compatible encoding applies bidirectionally to that live Session: backend output bytes are decoded with it and typed or pasted Unicode text is encoded with it. On macOS, a local UTF-8 Session also defaults `LC_CTYPE` to `UTF-8`, matching Terminal.app even when KKTerm launches from Finder; choosing a legacy per-Pane encoding does not apply that UTF-8 locale, and an explicit Connection environment variable takes precedence. The choice is stored with the frontend Pane/Child Connection Tab layout in local storage, not in the durable Connection or global Terminal Settings.

The same menu places Keyword Highlighting (`terminal.syntaxHighlight`) between Color Scheme and Font. `terminal.syntaxHighlightNone` disables local matching and is the default for every new Connection; every built-in and user-owned Keyword Highlighting profile from Settings → Terminal is available below it. The choice is stored on the durable Connection and live-applies without reconnecting. Matching is always case-insensitive. When a profile is enabled, each matching rule's configured foreground and background colors take precedence over the terminal color scheme and ANSI colors emitted by Bash or a remote program. Typography remains owned by xterm so highlighting cannot change terminal font metrics or duplicate glyphs. Keyword Highlighting operates on xterm's parsed visible buffer, never rewrites PTY bytes, never changes copied text, and remains opt-in per Connection.

Tutorial targets: `terminal.pane`, `terminal.surface`.

## Starting state

While a Session is starting up, the Pane shows:

- `terminal.starting` (spinner)
- `terminal.sessionFor` or `terminal.startingSessionFor` with the target name
- For SSH: `terminal.verifyingHostKey` while the host key is verified.

Failure shows `terminal.failedToStart` / `terminal.failedToStartDetail`. Outside the Tauri runtime (e.g. browser preview), `terminal.desktopRuntimeRequired` or `terminal.tauriRequired` is shown instead.

## Local WSL Connections

When adding or editing a Local Terminal Connection, choosing WSL from `connections.shell` makes KKTerm query the installed WSL distributions with the same `installer_wsl_list_distros` backend used by the Install Helper manager. If distributions are available, the form shows `connections.wslDistribution`; choosing one stores the shell as `wsl.exe --distribution <name>` so the Connection opens that distro directly. Leaving the field at `connections.default` keeps plain `wsl.exe` and follows the Windows default distribution. The terminal toolbar still shows the saved Connection name, such as `WSL - Ubuntu`, rather than the stored launch command. During new Connection creation, an explicit distro choice also seeds the Connection icon from the bundled OS icon set when a matching distro logo exists, unless the user picks an icon manually.

## Telnet compatibility

Telnet Sessions negotiate binary transfer, remote echo, suppress-go-ahead character mode, terminal type, and character-cell window size. KKTerm identifies its xterm.js surface as `XTERM`; when a server repeats the terminal-type request to ask for an alternative, KKTerm answers `VT100`, repeats that final fallback once to mark the end of the list, then cycles back to `XTERM` if the server asks again. LINEMODE and unsupported options are refused so legacy hosts can fall back to interactive character mode. Input escapes Telnet command bytes and follows NVT newline rules until binary mode is enabled. Pane resizes are sent after the server enables NAWS.

For troubleshooting, enable `settings.advancedDebugging` and inspect `telnet.debug.log` from `settings.openLogFolder`. The log records option names/codes, negotiation decisions, selected terminal type, window sizes, lifecycle errors, and byte counts. It deliberately omits terminal contents, typed input, and credential values.

## Serial troubleshooting

A Serial Pane prints one `[serial <line> <speed> <framing> flow=<mode>]` banner on connect, reporting the settings the OS actually applied rather than the ones that were requested. Mojibake or a Pane that never echoes almost always means that banner does not match the attached device; correct `connections.speed` in the Connection and use `connections.reconnect`.

For deeper troubleshooting, enable `settings.advancedDebugging` and inspect `serial.debug.log` from `settings.openLogFolder`. The log records the requested line, speed, and text encoding, the applied speed/character size/parity/stop bits/flow control, the CTS, DSR, and carrier-detect line states at open, input and output byte counts, and the reason the reader stopped. It deliberately omits terminal contents and typed input.

## Copy and paste

Ctrl-click an `http` or `https` link rendered in any terminal Pane to open it in the OS default browser through KKTerm's external opener. This applies to local, SSH, Telnet, and Serial terminal Sessions because they share the same xterm.js renderer.

- Copy selected text with `terminal.copy` (shortcut hint `terminal.copyShortcut`, default `Ctrl+Shift+C`) or Right-click → `terminal.copy`. The right-click Copy/Paste menu is native, so it remains visible over adjacent URL and RDP Panes. When `settings.copyOnSelect` is enabled, completing a mouse selection copies it to the system clipboard automatically; in tmux mouse mode, hold Shift while selecting so xterm.js performs a local selection instead of forwarding the drag to tmux.
- Paste: `terminal.paste` (default `Ctrl+V`, also `Ctrl+Shift+V`). Multi-line pastes prompt a confirmation `terminal.pasteMultilineConfirm` to prevent accidental command execution. The confirmation takes keyboard focus automatically: Enter accepts the paste and Escape cancels it. It stays above adjacent split Panes, including URL Connection browser surfaces, so its actions remain accessible.
- Right-click paste: when `settings.rightClickPaste` (Settings → Terminal → Clipboard and paste, hint `settings.rightClickPasteHint`, off by default) is enabled, right-clicking the terminal pastes the clipboard directly (PuTTY-style) instead of opening the context menu; Shift+right-click still opens the menu. The multi-line paste confirmation applies to right-click pastes too.

The terminal copy, paste, Quick Select, find, font-zoom, reconnect-active-Session, and split-Pane keys are customizable in Settings → Shortcuts (`settings.shortcuts`); the bindings named here are the shipped defaults. `settings.shortcutReconnectActiveSession` has no default binding so KKTerm never steals a shell, tmux, TUI, or remote-program chord; assigning it reconnects only the focused SSH, Telnet, or Serial Pane. `Ctrl+Insert` (copy) and `Ctrl+Shift+V` (paste) are fixed conventional aliases that stay active alongside whatever is bound.
- Send terminal buffer to AI: `terminal.sendToAi`. By default `settings.submitAiAttachmentsDirectly` submits the buffer with `ai.directAttachmentPrompt`; when disabled, the button only attaches the buffer to the composer.

Do not use `window.prompt` / `window.confirm` for paste confirmation; the implementation is an app-owned dialog with translated strings.

## Quick Select

`terminal.quickSelect` (Pane toolbar immediately left of `terminal.copySelection`, or Ctrl+Shift+Space) scans the visible terminal screen for copyable tokens — URLs, file paths, IPv4 addresses, MAC addresses, git hashes, UUIDs, and email addresses — and overlays a two-letter hint button on each match. Typing a label or clicking its button copies that token to the clipboard and reports `terminal.quickSelectCopied` through the Status Bar. Ctrl-clicking or Shift-clicking an `http` or `https` match opens it directly in the external browser; modified clicks on any other token copy it normally. Esc or a click on empty overlay space cancels (`terminal.quickSelectHint` is shown while active). If nothing on screen matches, the Status Bar shows `terminal.quickSelectNoMatches`. Matches are labelled bottom-up so the most recent output gets the shortest reachable labels.

## Shell integration (OSC 133)

When the shell emits OSC 133 command marks (as the WezTerm/VS Code shell-integration snippets for bash, zsh, fish, and PowerShell do), a command that exits non-zero gets a small red mark in the left gutter at the line where it finished (requires `D;exitCode`). Without shell integration this is simply inert — no configuration is required. tmux does not forward OSC 133 from the inner shell, so tmux-backed Panes do not surface it.

The prompt-to-prompt scrollback navigation and copy-last-command-output menu surfaces were removed/hidden because too few shells emit the marks by default; the renderer still tracks command-output zones so both can return once KKTerm can inject shell integration itself (see the roadmap).

## Inline images

When `settings.enableInlineImages` is on (default), programs can draw images directly into the terminal using the Sixel or iTerm2 inline image protocols (e.g. `imgcat photo.png` over SSH). Turning the toggle off applies to newly opened terminal Panes.

## Terminal notifications

When `settings.allowTerminalNotifications` is on (default), a program that raises an OSC 9 or OSC 777 notification (for example a long build signalling completion) surfaces it as a Status Bar notice using `terminal.notification` or `terminal.notificationWithTitle`, prefixed with the Connection name. Turning the toggle off silences already-open terminals immediately.

## Sync input to all terminals

Each terminal Pane toolbar has a `workspace.syncInput` toggle, immediately left of the Quick Command Bar toggle. When on, keystrokes typed into the focused terminal Pane are mirrored to every other open terminal Pane, for running the same command across many Sessions at once. Only real keyboard, IME, and paste text is mirrored — mouse and focus control sequences (clicks, drags, scroll, focus reports) are filtered out so they do not arrive as garbled coordinates in other Panes or in shells that never enabled mouse mode. Mirrored input goes straight to each target Pane's PTY, so multi-line paste confirmation still applies once on the Pane the user types in. Because input also reaches terminal Panes on Tabs that are not currently visible, enabling the toggle shows the warning popup `workspace.syncInputEnabledNotice`, the toggle pulses green on every terminal Pane, each receiving Pane shows a pulsing green outline, and connected terminal Connections in the Connection Tree replace their green status dot with a pulsing radio indicator. Activating either the sync-input toggle or the Quick Command Bar toggle returns text focus to the terminal Pane. Closing any participating terminal Pane turns the mode off immediately; closing a non-terminal Pane does not. The mode is runtime-only and off by default after launch.

## Find in scrollback

- Toggle search with the Pane toolbar; placeholder `terminal.findInScrollback`.
- Next / previous match: `terminal.nextSearch` / `terminal.previousSearch`.
- No matches: `terminal.noResults`.
- Close: `terminal.closeSearch`.

Tutorial target: `terminal.searchBar`.

## Font controls

In the Pane toolbar group `terminal.font` (Actions submenu `terminal.actions`):

- `terminal.increaseSize`
- `terminal.decreaseSize`
- `terminal.resetSize`

These controls apply the new size to every Pane in the current Tab and save it as
the global terminal font size, so the change is preserved across app launches. When `settings.hideTopTabButtons` is enabled and the focused Pane belongs to a Child Connection Tab, the font-size change is stored on that Child Connection Tab instead of the parent Connection or global terminal settings.

Font family, default size, ligature settings, and cursor style are configured globally in Settings → Terminal (see [15-settings.md](15-settings.md) §Terminal).

## View submenu

`terminal.view` toggles per-Pane rendering preferences exposed by the terminal Pane (cursor, line height, etc.).

## Appearance controls

The Pane hamburger menu (`terminal.actions`) includes per-Connection appearance controls for local, SSH, WSL/PowerShell, Telnet, and other xterm-backed terminal Connections:

- For SSH, Telnet, and Serial, the first hamburger-menu action is always `connections.reconnect`, including while the Session still appears connected, so a stalled Session can be restarted explicitly. If startup fails or the live Session ends while its Pane remains open, the same action is promoted to a visible `connections.reconnect` toolbar button. Both controls restart only their own Pane; they do not broadcast to other Panes that use the same durable Connection. Close the Pane with its dedicated toolbar close control.
- `terminal.opacity` opens a Transparency slider labelled by `terminal.opacityValue`. New terminal Connections default to 50% transparency; Settings - SSH and Settings - Terminal expose `settings.defaultTransparency` to change the starting value for newly-created SSH or local/Telnet/Serial terminal surfaces.
- `terminal.background` opens the same shared background picker used by Dashboard Views. It reuses the Dashboard background modes, shared background picker datasource, media picker (PNG/JPEG/WebP/GIF/BMP/SVG images and MP4/WebM/MOV/M4V/OGV videos), fit, dim labels, dynamic-background registry, and captured static Dynamic-tab thumbnails. The picker opens centered each time; drag its header to reposition it temporarily, and that location is not persisted. Dynamic backgrounds do not react to pointer clicks or presses; Particle Cursor, Silk Aurora, Closing Plasma, and Liquid Chrome may follow unpressed pointer movement. `terminal.backgroundDefaultHint` describes returning to the default terminal background.

- `terminal.colorScheme` opens the bundled 117-scheme catalog: KKTerm's original palettes plus every TerminalColors downloadable variant that is not already represented. Scheme names are proper nouns and stay untranslated. Every row uses the scheme's own background and foreground colors as an at-a-glance sample. Hovering a menu item previews that scheme in the current terminal Pane without saving it; moving out of the submenu restores the saved scheme. `terminal.colorSchemeGlobalDefault` clears the per-Connection override so the global default from Settings → Terminal (`settings.terminalColorScheme`) applies. Picking a scheme applies it live to every open Pane of the Connection and saves the override on the durable Connection record; save failures surface as `terminal.colorSchemeSaveFailed`. The scheme's background respects the Pane's transparency setting. The generated catalog is refreshed from `https://terminalcolors.com/` with `npm run terminal-colors:sync`; the app never fetches palettes at runtime.

Transparency and the default shared background are saved on the durable Connection record and are restored when that Connection opens again. For every xterm-backed Connection (local, SSH, Telnet, and Serial/COM), any non-default background—color/gradient preset, custom image/video, or dynamic—keeps the Pane toolbar 25 percentage points less transparent than the xterm surface: 100% xterm transparency produces 75% toolbar transparency, and xterm transparency at or below 25% produces an opaque toolbar. Choosing the default background explicitly removes the custom background instead of restoring the previous selection; only an absent per-Pane value inherits its Connection background. The toolbar derives its opacity from the exact shared or per-Pane background painted behind that xterm rather than from a protocol-specific Connection copy. The xterm host owns one full-area opacity layer, including the 8px text inset and any unused row-rounding space at the bottom; the xterm canvas and viewport remain transparent so the content is not darkened by double compositing. Child Connection Tabs save terminal font size, transparency, and background separately from their parent Connection, so a child row can relaunch with its own appearance. By default, one background is painted once behind the terminal workspace content area for the active Connection Tab, so split terminal Panes share a continuous backdrop. In a multi-Pane Panorama, the first terminal Pane in visual layout order owns that shared background: changing focus never changes the backdrop, and choosing a background from any later Pane saves it to the first Pane's Connection (or its Child Connection Tab appearance). Maximizing a terminal Pane temporarily makes that sole visible Pane the shared-background owner, so selecting a Child Connection shows and edits that child's own background; returning to Panorama view restores ownership to the first visual terminal Pane. In Settings > Workspace, `settings.separateSplitTerminalBackgrounds` enables per-Pane terminal backgrounds for split layouts; single-terminal Tabs behave the same as the default shared mode. Per-Pane terminal backgrounds are stored with the saved terminal layout and are restored with that layout after app launch. Settings - SSH and Settings - Terminal also expose `settings.randomDynamicBackgroundOnCreate`; when on, new terminal Connections, top-strip new Tabs, and new Child Connection Tabs start with a random dynamic background from the shared registry. Save failures are reported through the Status Bar with `terminal.appearanceSaveFailed`.

The Pane hamburger menu (`terminal.actions`) is anchored through the app-window portal so the leftmost Pane's submenus remain visible above the Activity Rail. Near the left edge, submenus flip to the right when that side has enough room.

## Quick Command Bar

The **Quick Command Bar** is the optional bottom bar for terminal Tabs. `terminal.quickCommandsShow` / `terminal.quickCommandsHide` toggles it. The default is off. The visible state is remembered per Connection id in durable frontend workspace storage and restored when that Connection is opened again, whether Workspace uses the top Tab Strip or Child Connection Tabs.

The Quick Command Bar shows the active Connection's saved Quick Commands and sends one to the focused terminal Pane. If the Tab has no active terminal Pane, KKTerm reports `terminal.quickCommandsNoPane` through the Status Bar. Quick Commands can optionally append Enter to the command text, and commands marked as risky show the app-owned confirmation dialog `terminal.quickCommandsConfirmTitle` / `terminal.quickCommandsConfirm` before sending input.

`terminal.quickCommandsManage` opens the manager dialog for the current Connection's Quick Command Bar. Its footer follows the host platform through the shared dialog action layout and offers `terminal.quickCommandsAddCommand`, `terminal.quickCommandsLibraryAction`, and `terminal.quickCommandsDone`. Custom commands let the user choose a built-in icon, an app palette color, or a custom color from the shared rainbow selector, and decide whether confirmation is required. If an AI API key is configured, `terminal.quickCommandsGenerateWithAi` can turn a short request such as `terminal.quickCommandsAiPromptPlaceholder` into a single command using the active Connection context, then inserts the generated text into the Command field without running it. Presets add common executable snippets to that Connection only.

Quick Command command, label, search, and AI-generation prompt fields use the
app's technical-input behaviour: OS autocorrect, autocapitalization, and
spellcheck are disabled in the WebView on Windows and macOS so shell text is not
rewritten while editing. Keyboard/IME suggestions outside the WebView remain
owned by the OS.

The AI Assistant and built-in MCP bridge can also inspect Quick Commands through `quick_command_list` / `quick_command_read`, create saved entries through `quick_command_create`, and update existing entries through `quick_command_edit`. Creating or editing a Quick Command saves it to the target Connection's Quick Command Bar but does not run it. In Prompt tool-permission mode, `quick_command_create` and `quick_command_edit` use the normal in-chat approval card before saving.

The From Library dialog keeps `terminal.quickCommandsSearch` at the top as a global filter, then organizes results with `terminal.quickCommandLibrary.categoryTabs` and `terminal.quickCommandLibrary.subcategoryTabs`. Built-in category tabs use the `terminal.quickCommandLibrary.categories.*` keys. Each entry shows its configured icon and palette accent. Risky or state-changing entries show `terminal.quickCommandsRequireConfirm` with warning emphasis and are saved with confirmation enabled so they show `terminal.quickCommandsConfirmTitle` / `terminal.quickCommandsConfirm` before sending input.

Each library entry has `terminal.quickCommandsAdd` to save it to the current Connection and `terminal.quickCommandsRun` to run it once in the selected terminal Pane without saving. One-shot runs close the library dialog first, then use the same confirmation prompt for risky entries. Entries with placeholders such as branch, container, pod, commit, network address, domain, key, or value keep Send Enter disabled by default so the user can edit the command before submitting.

Saved commands can be reordered with drag-and-drop from the grip handle or the `terminal.quickCommandsMoveUp` / `terminal.quickCommandsMoveDown` buttons.

### Quick Command Bundles

A **Quick Command Bundle** is an app-global, named list of Quick Commands that any Connection can select. Bundles are shared: editing one changes it for every Connection that selected it, including the ordering, icons, colors, Send Enter, and confirmation flags of its commands.

The Quick Command Bar starts with a bundle chip (`terminal.quickCommandBundleSwitch`) naming the bundle in use, or `terminal.quickCommandBundleNone` when the Connection keeps its own commands. The chip opens the picker dialog `terminal.quickCommandBundlesTitle` / `terminal.quickCommandBundlesSubtitle`, whose first row is `terminal.quickCommandBundleNone` (`terminal.quickCommandBundleNoneDesc`) followed by every bundle with its `terminal.quickCommandBundleCount_one` / `terminal.quickCommandBundleCount_other` command count. Selecting a row applies it immediately; the choice is remembered per Connection and restored the next time that Connection is opened. `terminal.quickCommandBundlesEmpty` shows while no bundles exist.

`terminal.quickCommandBundleNew` opens `terminal.quickCommandBundleNewTitle`, which asks for `terminal.quickCommandBundleName` (placeholder `terminal.quickCommandBundleNamePlaceholder`) and confirms with `terminal.quickCommandBundleCreate`. When the dialog is opened from a Connection, `terminal.quickCommandBundleCopyCurrent` seeds the new bundle with a copy of that Connection's current Quick Commands, so an existing list can be saved as a reusable bundle; the new bundle is then selected for that Connection. Bundle rows also carry `terminal.quickCommandBundleRename` (dialog `terminal.quickCommandBundleRenameTitle`) and `terminal.quickCommandBundleDelete`, whose confirmation `terminal.quickCommandBundleDeleteTitle` / `terminal.quickCommandBundleDeleteMessage` warns that Connections using the bundle fall back to their own Quick Commands.

While a bundle is selected, `terminal.quickCommandsManage` edits the bundle rather than the Connection: the manager subtitle becomes `terminal.quickCommandsBundleSubtitle` so it is clear that adding, editing, reordering, or deleting a command affects every Connection using that bundle. The AI Assistant and MCP `quick_command_*` tools follow the same selection, so they edit whichever list the Connection's Quick Command Bar currently shows.

Bundles and per-Connection bundle selections are durable frontend state stored in SQLite, so they are covered by settings backup/export and cleared by Reset All Settings. Deleting a Connection removes only that Connection's selection, never the shared bundle. The full bundle manager also lives in Settings → Terminal (`settings.quickCommandBundles`); see chapter 15.

## Saving the buffer

`terminal.save` / `terminal.saveBuffer` writes the current scrollback to a file. Dialog title `terminal.saveDialog`. File filters `terminal.logFiles` and `terminal.textFiles`. Failures surface as `terminal.bufferSaveFailed`. If no save dialog is available (non-Tauri runtime), the status is `terminal.noSaveDialog`. The same `terminal.actions` menu contains `workspace.takeScreenshot`, which opens the Region / entire Pane screenshot capture choices.

## Recording output

`terminal.startRecording` starts a local text recording for the current terminal Pane. KKTerm first writes the current frontend terminal buffer, then appends live output until recording stops. While active, the toolbar shows `terminal.recording`, the button changes to `terminal.stopRecording`, and the terminal Pane has a red outer border.

Live output is rendered to plain text before it is saved: KKTerm replays the raw stream (which carries VT escape sequences — cursor moves, erases, colors, window titles, and the aggressive ConPTY repaints of local Windows terminals) through a small screen model (`src-tauri/src/vt_text.rs`) and writes readable lines. A line is appended to the file once it scrolls out of the viewport; the remaining screen content is flushed when the recording stops. Colors and window titles are dropped, and alternate-screen content (full-screen apps like vim or htop) is not included in the recording.

When `settings.autoRecordSessions` (Settings → Terminal → Session defaults, hint `settings.autoRecordSessionsHint`, off by default) is enabled, every new terminal Session starts with recording already active, exactly as if `terminal.startRecording` was pressed at Session start — the toolbar shows the active recording state and the user can still stop it manually. Each Session records to its own file, so multiple Tabs or split Panes opened from the same Connection produce separate recordings in that Connection's folder (file names embed the start timestamp and a Session id fragment).

Stopping the recording, closing the Pane, or ending the terminal Session finalizes the text file under KKTerm app data. The terminal actions menu item `terminal.openRecordings` opens the universal `terminal.recordingsTitle` browser without a host filter. The blank area menu in the Connection Tree opens the same universal view; opening it from a selected terminal Connection's context menu applies that Connection as the initial host filter, which the user can clear or change. Deleting a Connection does not delete its recording files.

The browser opens at about 70% of the app window and has an explicit bottom-right resize grip that works independently of WebView2's native CSS resize affordance. Drag the grip, or focus it and use the Arrow keys (Shift for larger steps). It supports sortable and individually resizable name, type, host, date, time, duration, size, and AI-summary columns; faint row and column guides; host and date filters; multi-selection; ZIP export with an automatically suggested filename; and `terminal.openRecordingsFolder` for the recordings root. Exported recordings use a flat ZIP structure with every file at the archive root; duplicate names receive incremental suffixes such as ` (2)` and ` (3)` before the extension. The name column starts moderately wide, the color-coded type tags distinguish Local, SSH, Telnet, and COM recordings, and the AI-summary column consumes the remaining table width. Recordings whose original Connection can no longer be resolved use the Unknown type. Column separators support pointer dragging and Left/Right Arrow keyboard adjustment. Search matches recording metadata and full text. Content search runs only after the user types a query and prefers the platform command-line searcher: `rg` when available, then `findstr` on Windows or `grep` on macOS/Linux, with KKTerm's native reader as the last fallback. This is a user-initiated search, not a polling loop.

Opening the browser from a terminal while that Session is recording selects the current recording and scrolls it into view without applying a host filter. Selecting a recording name opens a resizable modal Document viewer/editor over the browser; it does not create, replace, or activate a Workspace Tab. Large recordings remain read-only but are not limited to a prefix: the Document viewer builds a sparse line index off the UI thread and lazily reads nearby pages as the user scrolls, so a 100 MB recording is completely navigable without sending the whole file to the webview. AI summaries are also opt-in: `terminal.recordingsGenerateSummary` summarizes one row, while `terminal.recordingsSummarize` processes selected rows sequentially. Summary requests use the same resolved output language as the AI Assistant setting. A generated summary stays in its table cell, wraps to at most three lines, and truncates any remaining text; hovering the cell exposes the complete summary. The subtle `terminal.recordingsRegenerateSummary` icon reruns one completed summary using the current AI language and overwrites its cache. KKTerm sends a bounded sample instead of the entire log: the beginning, command/error/outcome lines, periodic middle samples, and the ending. Otherwise, the generated summary is cached beside the recording and reused while the recording size and modification time remain unchanged, limiting repeat token cost while retaining useful evidence from large logs. Summary and export failures are transient Status Bar notices rather than inline outcome messages.

Tutorial targets: `terminal.startRecording`, `terminal.actions`.

## SSH-specific behaviour

Covered in [06-ssh-and-tmux.md](06-ssh-and-tmux.md).

## SFTP shortcut

From an SSH Pane: `terminal.openSftp` / `terminal.sftp` opens an SFTP browser Pane targeted at the same SSH Connection. See [07-sftp.md](07-sftp.md).

Tutorial targets: `terminal.openSftp`, `terminal.copySelection`, `terminal.sendToAi`.

## Connect / target labels

Generic placeholders used in error / status surfaces: `terminal.connectLabel`, `terminal.targetLabel`.

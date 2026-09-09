# 11 — App Launcher Widget

## AI grep hints

- Keys: `appLauncher.*` (full namespace)
- Topics: launch local apps from Dashboard, run as admin, run as user, open containing folder, pinned apps, rail shortcuts, add/edit/remove entry, icon/list/details view mode, sort launcher entries, file metadata
- Synonyms: "shortcuts", "dock", "quick launch", "run as administrator", "launch program", "open folder", "show in folder", "Explorer view", "details view", "list view", "sort by name", "sort by size", "sort by modified"

> **Term:** the App Launcher is a Dashboard widget, **not** an Activity Rail Module. The label that appears on its widget surface is `appLauncher.title` (Module-style label `appLauncher.moduleLabel`, summary `appLauncher.subtitle`, status `appLauncher.statusReady`).

## Entries

Each entry represents a desktop app, shortcut, script, or file. Stored fields (presented in `appLauncher.dialogTitle`):

- Name (`appLauncher.name`)
- Path (`appLauncher.path`) — required; missing path indicator `appLauncher.missingPath`.
- Arguments (`appLauncher.arguments`, placeholder `appLauncher.argumentsPlaceholder`)
- Working directory (`appLauncher.workingDirectory`, placeholder `appLauncher.workingDirectoryPlaceholder`)
- Pin to rail toggle (`appLauncher.pinToRail`). Pinned state badge `appLauncher.railPinned`.

The dialog itself is accessible-labelled `appLauncher.dialogLabel`. Summary line groups: `appLauncher.summaryLabel`, `appLauncher.pinnedApps`, `appLauncher.railShortcuts` (`appLauncher.railShortcutsLabel`), `appLauncher.entriesLabel`.

## Adding an entry

`appLauncher.addApp` opens the picker submenu:

- `appLauncher.addMenuApp` — pick an executable. Dialog title `appLauncher.selectAppTitle`.
- `appLauncher.addMenuFile` — pick a file. Dialog title `appLauncher.selectFileTitle`. File filter `appLauncher.fileFilter`; all-files fallback `appLauncher.allFilesFilter`.
- `appLauncher.addMenuFolder` — pick a folder. Title `appLauncher.selectFolderTitle`.
- `appLauncher.addFolder` — add a grouping folder inside the widget.

Loading state during picker: `appLauncher.loading`. Empty state: `appLauncher.emptyTitle`, `appLauncher.emptyHint`. Selection failure: `appLauncher.selectError`. Save failure: `appLauncher.saveError`. Save status: `appLauncher.savedStatus`.

## View modes

The widget surface supports Explorer-style view modes. The view-mode control is labelled `appLauncher.viewModeLabel` and appears when the pointer or keyboard focus enters the widget. It offers:

- `appLauncher.iconView` — icon grid, the default for existing widgets.
- `appLauncher.listView` — compact row list.
- `appLauncher.detailsView` — row list with `appLauncher.detailsNameColumn`, `appLauncher.detailsTypeColumn`, `appLauncher.detailsSizeColumn`, `appLauncher.detailsModifiedColumn`, and `appLauncher.detailsPathColumn` headers.

File-name labels may wrap to two lines in the launcher surface so longer local app or document names remain readable.

List and Details headers are clickable sort controls. List sort and Details sort are stored separately; switching view modes restores that mode's last sort. Icon view remains separate and keeps the manual drag order stored in the entry list.

In the desktop app, entries are added through the `appLauncher.addApp` picker described above; dragging files in from the OS file manager is not supported, because KKTerm runs with the webview's native drag-drop handler disabled (required so in-app HTML5 drag-and-drop works on Windows), which means OS file drops never report a path. The browser preview (dev/web build, where OS drops still report paths) keeps a drop target that covers the entire widget body, so those drops can land anywhere inside the widget surface.

Details values come from live local file metadata when available:

- Type values use `appLauncher.folderType`, `appLauncher.fileType`, `appLauncher.fileTypeWithExtension`, or `appLauncher.unknownFileType`.
- Missing size or modified time uses `appLauncher.notAvailable`.

## Right-click context menu on an entry

App Launcher actions live in a native Tauri right-click menu, not the default surface. The native menu remains visible when the widget sits beside an embedded URL or RDP Connection widget. Icon and list views show the icon and label; Details view also shows type, size, modified time, and the stored local path for comparison.

- Launch: `appLauncher.launchApp`. Variants: `appLauncher.runNormal`, `appLauncher.runAdmin` (UAC elevation), `appLauncher.runAsUser` (run as a different user). `appLauncher.runAdmin` and `appLauncher.runAsUser` map to Windows shell verbs (`runas` / `runasuser`) and only appear on Windows; macOS and Linux show `appLauncher.runNormal` and `appLauncher.openFolder` only. A normal launch opens the entry through the host OS default handler (Windows `explorer.exe`, macOS the platform opener), so non-runnable files and folders never shell out to `explorer.exe` on macOS or Linux. On Linux, entries with an execute permission bit run directly (with any stored arguments and working directory), `.desktop` entries launch the application they describe via `gio launch`, and all other files and folders open through the desktop default handler (`xdg-open`, falling back to `gio open`); launches scrub AppImage-injected environment variables so host applications resolve correctly.
- `appLauncher.openFolder` — open the containing local folder for files, shortcuts, scripts, and apps; for folder entries, open that folder.
- `appLauncher.editApp` / `appLauncher.edit` — open the edit dialog.
- `appLauncher.removeApp` / `appLauncher.remove` — delete. Status `appLauncher.removedStatus`.
- `appLauncher.moreActions` — overflow menu.

Launch lifecycle status:

- In flight: `appLauncher.launchStatus`.
- Failure: `appLauncher.launchError`.
- General load failure: `appLauncher.loadError`.

## Pin to Activity Rail

Pinning an entry (`appLauncher.pinToRail`) places its icon in the Activity Rail's Connection Rail group (`app.connectionRail`) alongside pinned Connections — see [02-app-layout.md](02-app-layout.md). Unpinning is reversible without destroying the entry.

## Mac App Store folder access

Only the Mac App Store build requires persistent sandbox grants. `appLauncher.addFolder`
uses the native folder picker. Dropping a Finder folder onto the App Launcher also
adds it and remembers access using a security-scoped bookmark. If the drag source
cannot transfer usable access, `appLauncher.grantAccess` opens a native picker;
canceling skips that item. Multiple dropped items are handled individually.

Typed paths, imported entries, and entries whose permissions can no longer be
restored use `appLauncher.grantAccess` when saved or launched. The selected path
is the target used by that action. Existing bookmarks are resolved without a dialog,
including after quitting and reopening KKTerm. Unavailable volumes may require
reconnecting and selecting the folder again. Bookmarks stay on this Mac and are
not included in Settings exports. Direct-download macOS, Windows, and Linux
builds retain their existing file-access behavior.

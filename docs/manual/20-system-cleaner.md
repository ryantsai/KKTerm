# System Cleaner

## AI grep hints

`app.activityRailSystemCleaner`, `systemCleaner.title`, `systemCleaner.page`,
`systemCleaner.drive`,
`systemCleaner.scan`, `systemCleaner.content`, `systemCleaner.overview`,
`systemCleaner.storage`, `systemCleaner.cleanup`,
`systemCleaner.apps`, `src/modules/system-cleaner/SystemCleanerPage.tsx`, disk usage,
allocated size, logical size, temporary files, cache,
exact cleanup preview, cleanup history, uninstall

The **System Cleaner** Module is available only on Windows. Open it from the
Activity Rail. The Module has one **`systemCleaner.overview`** surface; Storage,
Cleanup, and uninstall are sections on that Overview, not separate destinations.
The Overview places a summary card above three equal full-height panels, with no
secondary navigation rail. Each panel scrolls its own results instead of growing
the page. Panels adapt to their own width rather than the window's: a narrow
panel drops its least essential columns first, and restores them when the layout
gives it more room. Every section remains visible before a disk scan; scan-bound
values use placeholders until results arrive, while the installed-application
list loads independently.

## Select and scan a drive

The compact native selector in the Module header changes the active fixed or
removable drive. Changing drives clears the previous drive's scan-bound
Storage and Cleanup results. The installed-application list is computer-wide,
so it remains available across drive changes.

Choose the sole **`systemCleaner.scan`** action at the top right of the Module
header to start an explicit scan. Section bodies do not contain additional Scan
actions. System Cleaner never
scans on mount, activation, or a schedule. KKTerm uses its reparse-safe iterative
Rust directory walker directly; the scan does not launch an elevated helper or
read the NTFS master file table. No external storage scanner is downloaded or
installed.

The centered scan state continuously reports file/byte progress through
**`systemCleaner.scanProgress`**. The Module and Status Bar share the same
Searching activity indicator. Directory reparse points are never followed.

After scanning, the summary reports elapsed time and the scanned item count
above four cards. **`systemCleaner.usedSpace`** carries used space, its share of
the drive as a proportion bar, and free capacity through
**`systemCleaner.freeOfTotal`**, so one card answers both how much is used and
how much is left. **`systemCleaner.storageByCategory`** breaks the scanned
allocation into Videos, Images, Audio, Documents, Programs, and Other as a
stacked bar with a labelled legend; every segment is named and sized in that
legend, so the chart never depends on color alone, and
**`systemCleaner.fileCategory.other`** absorbs both uncategorized file types and
the tail below the scan's largest-extension list so the segments always sum to
the scanned total. The
remaining cards carry reclaimable built-in cleanup categories and the
installed-application count. Values that need a scan show a muted placeholder
until results arrive.

## Storage analysis

The **`systemCleaner.storage`** section browses the scanned drive with the same
breadcrumb, row, column, and selection conventions as File Explorer.
Double-click a folder or focus it and press Enter to open it; use a breadcrumb
or the up action to return to a parent. Right-click an item for the native File
Browser actions that apply to this read-only analysis view: open, copy, and
**`sftp.copyPath`**.

Folder sizes come from the completed one-pass scan, so opening a folder reads
only its immediate entries instead of walking that subtree again. Rows show
logical file sizes through **`systemCleaner.size`** and physical allocation
through **`systemCleaner.allocated`**. Percent bars and the default descending
sort use allocated bytes without grouping folders ahead of larger files. The
footer summarizes both measurements through
**`systemCleaner.storageTotals`**. The Rust walker reads logical file lengths,
uses Windows compressed-size reporting for compressed or sparse files, and
otherwise estimates physical allocation from the volume allocation unit.

System Cleaner reports storage but does not delete items from this section.
Choose **`systemCleaner.scan`** again after moving or deleting files.

## Cleanup

The **`systemCleaner.cleanup`** section contains only KKTerm's reviewed,
built-in file cleanup categories: user and Windows temporary files; Edge,
Chrome, Firefox, Brave, Vivaldi, and Opera caches; Teams, Discord, Slack,
VS Code, JetBrains, Steam, Zoom, and Office caches; npm, pnpm, Yarn, NuGet,
pip, Cargo, Rust build/toolchain, and Gradle caches; DirectX, NVIDIA, and AMD
shader caches;
thumbnail/icon caches; crash dumps; Windows Error Reporting; and selected
Windows logs. User-authored rules, signed bundles, Winapp2 imports, and the
Keep List are not part of System Cleaner.

Cleanup categories remain visible before scanning and show placeholders instead
of cleanup totals. Scan results fill their sizes and order all categories from
largest to smallest; safety badges stay attached to each category rather than
changing that size order. Each row pairs the category name and safety badge
with a plain-language description of what the category removes, so the decision
does not depend on reading a path. The row's full target path stays available as
its tooltip.

**`systemCleaner.category.git-worktrees`** is the one category that does not
remove rebuildable data. It targets the coding-agent worktree
roots `%USERPROFILE%/.claude/worktrees` and `%USERPROFILE%/.codex/worktrees`
plus per-project `.claude/worktrees` folders inside repositories kept under your
user profile. A repository stored in a protected personal folder — Desktop,
Documents, Downloads, Pictures, Music, Videos, OneDrive, or Dropbox — stays
behind the protected-path firewall, so its worktrees are never matched and the
category reports nothing for them.

Those checkouts can contain uncommitted work, so the category is Risky, is never
selected automatically, and — like every category — only removes the exact files
shown in the preview. After removing one, run `git worktree prune` in the parent
repository to clear its stale registration.

Browser cache cleanup removes cache assets only. It does not target history,
cookies, passwords, bookmarks, extensions, IndexedDB, local storage, or
sessions. Personal folders, cloud-sync roots, credentials, source-control
repositories, browser profile databases, extensions, local storage, and
sessions remain behind a non-bypassable protected-path firewall.

Select categories and choose **`systemCleaner.previewCleanup`**. The backend
creates an immutable plan containing every exact regular file, size,
last-change time, Windows file identity, category version, and canonical target
root. Approving **`systemCleaner.cleanTitle`** never re-expands paths. When the
approved selection contains a Risky category, a second confirmation,
**`systemCleaner.riskyCleanupTitle`**, names those categories and must also be
approved before anything is deleted; cancelling it leaves the plan intact so the
selection can be changed and previewed again. Before
each deletion, the backend verifies that the file remains regular and
non-reparse, is inside the original target, retains the same size/time/identity,
is not protected, and is not owned by a guarded running application. Changed,
missing, locked, protected, or application-owned files are skipped. Cleanup can
be cancelled and skipped paths can be retried against the same plan.

Approved attempts and outcomes are appended to
`system-cleaner.operations.log`; structured history remains available to the
AI/MCP command layer. System Cleaner does not modify the registry and never
runs a cleanup category as PowerShell, a shell command, a process action, or a
database mutation.

## Applications

The **`systemCleaner.apps`** section loads independently of the disk scan and
lists every package detected by Windows Package Manager. KKTerm parses WinGet's
fixed columns so names containing spaces and rows with available upgrades keep
their proper display names. Each row shows the truthful package id, plus the
publisher, version, and registry `EstimatedSize` when Windows provides them.
Estimated size is advisory rather than a measured on-disk total; unknown sizes
sort after known sizes. Applications default to descending estimated size.
**`systemCleaner.aiExplain`** sends those package details to the current AI
Assistant and asks what the application does plus dependencies, caveats, and
likely effects of uninstalling it. It does not assign a removal-safety verdict.
**`systemCleaner.uninstall`** opens a destructive
confirmation, then launches a separate elevated helper for the package's
interactive uninstaller. Multi-select uninstall keeps one UAC approval and
helper per package. Every approved uninstall is recorded in
`system-cleaner.operations.log`, and transient outcomes appear in the Status
Bar.

# System Cleaner

## AI grep hints

`systemCleaner.title`, `systemCleaner.storage`, `systemCleaner.cleanup`,
`systemCleaner.apps`, `app.activityRailSystemCleaner`,
`src/modules/system-cleaner/SystemCleanerPage.tsx`, disk
usage, allocated size, logical size, large files, temporary files, cache,
uninstall, Windows cleanup

The **System Cleaner** Module is available only on Windows. Open it from the
Activity Rail. The Module opens without scanning. Select a fixed or removable
drive in the Storage toolbar, then choose
**`systemCleaner.scan`** from the Module header or the empty state to read the
selected drive, measure its top-level folder tree and file-type totals, check a
conservative set of cache locations, and ask Windows Package Manager for the
installed-app list. The centered scan state continuously reports the files and
bytes read through **`systemCleaner.scanProgress`**. While scanning, the Storage
view and the Status Bar show the same Searching activity indicator. The current
scan path is display-only and truncates when it is wider than the available
space. The elevated scanner first reports file-index progress through
**`systemCleaner.scanMetadataProgress`**, then streams file counts, logical
bytes, and the current file name while KKTerm imports the scan report.

## Storage analysis

Choose **`systemCleaner.storage`** to browse the scanned drive with the same
breadcrumb, list-row, column, and selection conventions as File Explorer.
Double-click a folder or focus it and press Enter to open it; use a breadcrumb
or the up action to return to a parent. Right-click an item for the native File
Browser actions that apply to this read-only analysis view: open, copy, and
**`sftp.copyPath`**. Folder sizes come from the completed one-pass scan, so
opening a folder reads only its immediate entries instead of walking that
subtree again. The adjacent file-type table remains scoped to the whole drive.
The Storage toolbar shows the selected drive's Windows-reported total, used,
and free allocation. Storage rows and file-type rows show both logical file
sizes through **`systemCleaner.size`** and physical allocation through
**`systemCleaner.allocated`**; their
percent bars and default descending order use allocated bytes. The folder
footer summarizes both measurements through **`systemCleaner.storageTotals`**.
Allocated totals come from WinDirStat's exported **Physical Size** values, while
logical totals come from its **Logical Size** values. WinDirStat handles NTFS
compression, sparse and WOF-backed files, hard links, and allocation-unit
rounding before KKTerm imports the report. Filesystem metadata outside folder
totals remains in the reserved or unattributed value identified by
**`systemCleaner.allocationDetail`**. Directory reparse points are never
traversed, avoiding duplicate target data.

System Cleaner uses an Install Helper-managed portable WinDirStat release. On
the first scan, **`systemCleaner.scannerInstallTitle`** and
**`systemCleaner.scannerInstallPrompt`** ask permission to install that internal
dependency. KKTerm then requests standard UAC approval for the headless scan so
WinDirStat can use its direct NTFS engine. The helper runs without opening a
terminal window; the standard UAC consent prompt remains visible. If the
external scan cannot run, KKTerm falls back to its non-elevated, reparse-safe
directory walker. The drive scan runs on a background worker while cleanup
locations and installed-app discovery run concurrently.
Scans run only on explicit demand; use
**`systemCleaner.scan`** to refresh the measurements after moving or deleting
files. System Cleaner reports sizes but does not delete items from this view.

## Cleanup

Choose **`systemCleaner.cleanup`** to review a responsive card grid of
rebuildable caches and temporary data: user and Windows temporary files,
Microsoft Edge, Google Chrome, and Mozilla Firefox caches, the DirectX shader
cache, and the exact Windows `thumbcache_*.db` thumbnail files. Application
crash dumps and Windows Error Reporting archives/queues are also shown, but are
not selected by default because they may still be useful for diagnosis. Every
card explains what the files are and why the category can be cleaned. Browser
cache cleanup removes cache assets only; it does not target history, cookies,
passwords, or bookmarks. Select the categories to remove, review the estimated
size in **`systemCleaner.clean`**, and approve the destructive confirmation
before cleanup starts. The Cleanup view shows the Working orb and
**`systemCleaner.cleaningWorking`** until cleanup and the follow-up measurement
finish. Files currently locked by Windows or another application are left in
place. The Module does not modify the registry. Approved cleanup and uninstall
attempts and their outcomes are appended to `system-cleaner.operations.log` in
KKTerm's local log directory.

## Uninstall applications

Choose **`systemCleaner.apps`** to view packages detected by Windows Package
Manager in a responsive multi-column card grid. **`systemCleaner.aiExplain`**
sends only the selected package's displayed name, package id, and version to the
current AI Assistant model, opens the shared Assistant Panel, and asks what the
application does and what uninstalling it may affect.
**`systemCleaner.uninstall`** opens a destructive confirmation sheet; after
confirmation, KKTerm launches a separate elevated helper. Windows displays the
standard UAC approval prompt before that helper starts the package's interactive
uninstaller. The package owns removal of its registered files and settings.
System Cleaner does not perform speculative registry sweeping.

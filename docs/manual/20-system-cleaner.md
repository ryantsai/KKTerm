# System Cleaner

## AI grep hints

`systemCleaner.title`, `systemCleaner.storage`, `systemCleaner.cleanup`,
`systemCleaner.apps`, `app.activityRailSystemCleaner`,
`src/modules/system-cleaner/SystemCleanerPage.tsx`, disk
usage, large files, temporary files, cache, uninstall, Windows cleanup

The **System Cleaner** Module is available only on Windows. Open it from the
Activity Rail. The Module opens without scanning. Choose
**`systemCleaner.scan`** from the Module header or the empty state to read the
Windows system drive, measure its
top-level folder tree and file-type totals, check a conservative set of cache
locations, and ask Windows Package Manager for the installed-app list. The
scan toolbar continuously reports the files and bytes read through
**`systemCleaner.scanProgress`**, then reports elapsed time through
**`systemCleaner.scanComplete`**. While scanning, the Storage view and the
Status Bar show the same Solving activity indicator. The current scan path is
display-only and truncates when it is wider than the available space.

## Storage analysis

Choose **`systemCleaner.storage`** to browse the scanned drive with the same
breadcrumb, list-row, column, and selection conventions as File Explorer.
Double-click a folder or focus it and press Enter to open it; use a breadcrumb
or the up action to return to a parent. Folder sizes come from the completed
one-pass scan, so opening a folder reads only its immediate entries instead of
walking that subtree again. The adjacent file-type table remains scoped to the
whole drive. The drive scan runs on a background worker while cleanup locations
and installed-app discovery run concurrently. Scans run only on explicit demand; use
**`systemCleaner.scan`** to refresh the measurements after
moving or deleting files. System Cleaner reports sizes but does not delete
items from this view.

## Cleanup

Choose **`systemCleaner.cleanup`** to review temporary files, the Microsoft
Edge cache, and the Windows thumbnail cache. Select the categories to remove,
review the estimated size in **`systemCleaner.clean`**, and approve the destructive confirmation before cleanup starts.
Files currently locked by Windows or another application are left in place.
The Module does not modify the registry. Approved cleanup and uninstall attempts and their outcomes are appended to `system-cleaner.operations.log` in KKTerm's local log directory.

## Uninstall applications

Choose **`systemCleaner.apps`** to view packages detected by Windows Package
Manager. **`systemCleaner.uninstall`** opens a destructive confirmation sheet;
after confirmation, KKTerm launches a separate elevated helper. Windows displays the standard UAC approval prompt before that helper starts the package's interactive uninstaller. The package owns removal of its registered files and settings.
System Cleaner does not perform speculative registry sweeping.

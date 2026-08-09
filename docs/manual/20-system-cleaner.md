# System Cleaner

## AI grep hints

`systemCleaner.title`, `systemCleaner.storage`, `systemCleaner.cleanup`,
`systemCleaner.apps`, `app.activityRailSystemCleaner`,
`src/modules/system-cleaner/SystemCleanerPage.tsx`, disk
usage, large files, temporary files, cache, uninstall, Windows cleanup

The **System Cleaner** Module is available only on Windows. Open it from the
Activity Rail. Its first scan reads the current Windows user folder, measures
the largest immediate files and folders, checks a conservative set of cache
locations, and asks Windows Package Manager for the installed-app list.

## Storage analysis

Choose **`systemCleaner.storage`** to see the largest items beneath the scanned
user folder. Use **`systemCleaner.scan`** to refresh the measurements after
moving or deleting files. System Cleaner reports sizes but does not delete
items from this view.

## Cleanup

Choose **`systemCleaner.cleanup`** to review temporary files, the Microsoft
Edge cache, and the Windows thumbnail cache. Select the categories to remove,
review the estimated size in **`systemCleaner.clean`**, and start cleanup.
Files currently locked by Windows or another application are left in place.
The Module does not modify the registry.

## Uninstall applications

Choose **`systemCleaner.apps`** to view packages detected by Windows Package
Manager. **`systemCleaner.uninstall`** opens a destructive confirmation sheet;
after confirmation, KKTerm launches the package's interactive Windows
uninstaller. The package owns removal of its registered files and settings.
System Cleaner does not perform speculative registry sweeping.

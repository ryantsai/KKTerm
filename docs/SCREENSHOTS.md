# Screenshots Module — Plan

Status: **Phase 2 core workflows implemented.** This document was the working plan for the
top-level **Screenshots** Module (functionality mirroring third-party
screenshot tools such as ShareX / PicPick / Snipping Tool) and now serves as
its deep-dive reference. The shipped Phase 1 matches the plan below; the
user-facing behavior is documented in `docs/manual/14-screenshots.md` and the
source map lives in `docs/ARCHITECTURE.md` → "Frontend Source Map".

## Scope decisions (confirmed)

- **First-party built-in Module** on the Activity Rail, same tier as
  Dashboard / Install Helper / IT Ops. Not an extension-platform package
  (ADR 0005's extension runtime is draft-only anyway).
- **Visible on the rail by default**, hideable via Settings → General like the
  other Modules. (IT Ops is also default-visible since the v47 release
  migration; the docs that still said "hidden by default" were corrected as
  part of this planning pass.)
- **Default save format is PNG** (lossless, ShareX-like); the format is a
  user-selectable default in Settings → Screenshots, with JPEG + quality as
  the alternative. Existing JPEG files in the library remain fully supported.
- **Global shortcut defaults**: `Ctrl+Alt+R` (region), `Ctrl+Alt+W` (window),
  `Ctrl+Alt+F` (fullscreen), each editable and individually toggleable.
- Windows is the v1 capture platform. The existing native capture pipeline
  (GDI/DXGI + selection overlays) is Windows-only; macOS/Linux library capture
  via `xcap` is a later phase. The Module UI itself is cross-platform and shows
  the library read-only wherever capture is unavailable.

## What already exists (reuse, do not rebuild)

Backend (`src-tauri/src/screenshot.rs`, commands in `src-tauri/src/lib.rs`):

- `capture_interactive_region_screenshot_to_library` — full native region
  selection overlay (crosshair, Esc cancel) over a frozen virtual-screen frame.
- `capture_active_window_screenshot_to_library` — native window picker
  (enumerated window rects, click to choose).
- `capture_fullscreen_screenshot_to_library` — virtual screen (all monitors).
- All three minimize/restore the KKTerm window around the capture
  (`MinimizedCaptureWindow`) and save `KKTerm-<kind>-<millis>.jpg` into the
  configured library folder.
- `list_screenshots` (paginated, mtime-desc), `delete_screenshot`,
  `clear_screenshots`.
- GDI capture with DXGI desktop-duplication fast path
  (`use_directx_screen_capture` General setting), DIB→JPEG encode, clipboard
  writers, plus the in-app rect/panel capture used by `ScreenshotMenu` and the
  AI Assistant.
- `ScreenshotSettings { folder_path }` persisted in settings storage; default
  folder is the Windows Known Folder *Screenshots* (falls back to
  `~/Pictures/Screenshots`).

Frontend:

- Typed wrappers for every command above already exist in `src/lib/tauri.ts`.
- `src/modules/workspace/ScreenshotMenu.tsx` — per-Pane capture menu; its
  Region and Entire Window/Panel actions use the Module's persisted delivery
  settings, while its AI Assistant capture actions remain transient.
- App Launcher widget already implements the list / details / tile view-mode
  pattern this Module's library will mirror.
- Tray (`src-tauri/src/app_tray.rs`) builds its menu from a localized snapshot
  pushed by the frontend — the extension point for capture menu items.

**Nothing in the UI consumes the library commands yet.** The Module is
greenfield frontend work plus modest backend additions.

## Product design (v1)

### Module shell

- New Activity Rail item `screenshots` (icon: camera), between Install Helper
  and IT Ops by default; visible by default, hideable via Settings like other
  Modules (`showScreenshotsOnRail`), reorderable via `activityRailOrder`.
- Default view: the **Library** — screenshots from the configured folder,
  sorted by capture date (newest first, the existing list order).
- The compact `ModuleHeader` owns the identity, library count, view switch,
  sort/group controls, Refresh, Open folder, delayed capture selector, and
  capture actions on one row so the library starts immediately below it.
  Labels collapse responsively before controls are hidden.

### Library

- Two view modes, persisted in `localStorage`:
  - **Thumbnails** (default) — responsive card grid of image previews with
    filename + relative date.
  - **Details** — table: thumbnail, filename, kind (Region / Window /
    Fullscreen), dimensions, size, date.
- Uses the existing pagination (`offset`/`limit`, "Load more" or
  infinite scroll) — no new virtualization dependency.
- Row/card actions (native context menu via `src/lib/nativeContextMenu.ts`):
  Open (viewer), Edit, Copy to clipboard, Open in default app, Reveal in
  Explorer/Finder, Rename, Resize selected, Convert selected, and Delete.
  The toolbar keeps icon-only Open folder and Refresh actions; bulk deletion is
  selection-based instead of a destructive Clear all shortcut.
- Double-click opens one `Sheet`-based viewer/editor with Fit as its safe
  default, explicit 25–200% zoom, scrolling for enlarged images, previous/next
  navigation, item actions, and annotation tools.
- Empty state doubles as onboarding: explains capture buttons, tray items, and
  hotkeys.

### Capture actions

Buttons in the Module toolbar (and mirrored in tray + hotkeys):

- **Capture region** — interactive region overlay.
- **Capture window** — interactive window picker.
- **Capture full screen** — all monitors.
- Each returns the saved `StoredScreenshot`; the Library prepends it,
  flash-highlights it, and a Status Bar notice confirms
  (`showStatusBarNotice`, per the notification invariant).
- Optional **capture delay** (Instant/3/5/15/30/60 s) as a small dropdown next
  to the capture buttons (a frontend delay before invoking the shared bridge).

### Tray integration

- Extend `TrayMenuSnapshot` with localized capture labels; add a
  **Capture** section (or submenu): Capture region / Capture window /
  Capture full screen.
- Menu handler runs the capture directly in Rust (`tauri::async_runtime::
  spawn_blocking`, reusing the same command bodies) — it must work while the
  main window is hidden in the tray. On success, emit
  `kkterm://screenshot-captured` with the `StoredScreenshot` so the frontend
  refreshes the Library and shows the Status Bar notice when visible.

### Global shortcuts

- Add official plugin `tauri-plugin-global-shortcut` (Rust) +
  `@tauri-apps/plugin-global-shortcut` (npm).
- Three configurable accelerators (defaults are Windows-safe, avoiding
  PrintScreen which Windows 11 binds to Snipping Tool):
  - Region: `Ctrl+Alt+R`
  - Window: `Ctrl+Alt+W`
  - Fullscreen: `Ctrl+Alt+F`
- Shortcuts are registered at startup from settings, re-registered on change,
  with per-row clear actions and conflict errors surfaced in Settings.
  Handlers share the tray code path (work while hidden to tray).

### Settings

New **Settings → Screenshots** section (Settings Sidebar entry):

- Library folder (existing `folderPath`, folder picker via dialog plugin).
- Capture Mode: Save to folder, Clipboard, or Both (default). The same captured
  DIB is delivered to each selected destination; clipboard-only leaves no file.
- Image format: **PNG (default)** or JPEG with an always-visible quality slider. Stored in
  `ScreenshotSettings` as optional serde-defaulted fields (no SQLite schema
  migration — screenshot settings are settings-storage JSON). JPEG interprets
  the value as lossy quality; PNG stays lossless and maps it to compression
  effort. Existing files keep listing/opening normally.
- Global shortcut editors appear in both Screenshots and Shortcuts through one
  shared draft. Clearing a row disables it; entering a binding enables it.
- The DirectX capture toggle is shown in Screenshots (it remains in General
  settings storage so the assistant capture path continues sharing the value).

## Backend work items

1. **Thumbnail-aware listing.** `list_screenshots` currently base64-encodes
   every full image into `data_url` — unusable for a gallery of hundreds of
   shots. Change `StoredScreenshot` for the list path to return metadata +
   `thumbnail_data_url` (`image` crate downscale to ≤~320 px long edge, JPEG);
   add `read_screenshot(id)` returning the full-size `data_url` for the viewer
   and clipboard copy. Thumbnails cached in `<folder>/.kkterm-thumbs/`
   (mtime-keyed) so repeat listings are fast; cache is best-effort and
   excluded from listing. (Asset-protocol serving was considered, but its
   scope is static config while the library folder is user-configurable, so
   data-URL thumbnails through commands are the robust path.)
2. **PNG/JPEG format + quality.** `save_dib_to_library` reads
   `ScreenshotSettings.format` (`"png" | "jpeg"`, serde default `png`) and
   the shared `quality` value. Legacy `jpegQuality` JSON is accepted as an
   alias. JPEG uses lossy quality; PNG maps 1–100 to lossless compression
   effort. File names use `KKTerm-<kind>-<millis>.<ext>`.
3. **`rename_screenshot(id, new_name)`** with the same traversal guards as
   `screenshot_path_from_id`.
4. **Copy stored screenshot to clipboard** — `copy_screenshot_to_clipboard(id)`
   reusing `write_rgba_to_clipboard`.
5. **Tray capture entries** — snapshot fields + menu items + direct capture +
   `kkterm://screenshot-captured` event (also emitted by the command path so
   the Library refreshes regardless of who captured).
6. **Global shortcut registration** — plugin init, settings-driven
   (re)registration, handlers delegating to the tray capture path.
7. **Reveal in file manager** — reuse existing opener plugin
   (`tauri-plugin-opener` `reveal_item_in_dir`).

All new commands go through the existing `run_blocking_screenshot_command`
wrapper and typed `src/lib/tauri.ts` entries.

## Frontend source placement

New source area `src/modules/screenshots/`:

- `ScreenshotsPage.tsx` — Module shell (ModuleHeader, capture actions, view
  switcher).
- `LibraryView.tsx` — thumbnails/details rendering + pagination.
- `ScreenshotEditor.tsx` — unified image viewer/editor dialog.
- `state.ts` — small Zustand slice or local state: items, view mode, paging,
  capture-in-flight; subscribes to `kkterm://screenshot-captured`.
- `screenshots.css` — imported through `src/App.css` (cascade-order rule).
- Settings UI in `src/modules/settings/` following existing section pattern.

App wiring: `ActivityRailItemId` union in `src/types.ts`,
`activityRailOrder.ts` (default order + visibility map), `ActivityRail.tsx`,
`App.tsx` routing, `appNavigationPersistence.ts`, ModuleHeader identity icon,
General Settings visibility toggle.

## Compliance checklist (repo rules that bite)

- **i18n**: new `screenshots` namespace in `en.json` first + one pending file
  per key under `docs/localization_todo/`; all 14 locales; zh-TW Taiwan
  terminology (螢幕擷取 not 截屏/屏幕截图-style Mainland terms). Update the
  `CONTEXT.md` Namespace paragraph, which currently states "There is no
  `screenshots` namespace".
- **CONTEXT.md**: add Screenshots Module and Screenshot Library vocabulary
  entries; update the Modules list in `AGENTS.md` Working Rules.
- **Manual**: new `docs/manual/` chapter + `INDEX.md` + bundle resource entry
  in `tauri.conf.json`.
- **Tutorial**: stable `data-tutorial-id`s, entries in
  `src/app/tutorialNavigationModel.ts`, matching `tutorial_highlight` metadata
  in `src-tauri/src/ai.rs` (`npm run check` validates).
- **Dialogs/overlays**: viewer, batch sheets, editor, and confirm dialogs use
  `src/app/ui/dialog` primitives and portal to `document.body`; deletion uses
  ConfirmSheet and item commands use `nativeContextMenu.ts`.
- **Notifications**: only `showStatusBarNotice` / `showStatusBarProgress`.
- **No SQLite schema change** expected (settings-storage JSON only) — no
  migration audit needed unless that assumption breaks.

## Dependency decisions (reuse over reinvent)

| Need | Choice | Status |
| --- | --- | --- |
| Screen capture (Windows) | existing GDI/DXGI pipeline in `screenshot.rs` | already built, keep |
| Screen capture (macOS/Linux) | `xcap` 0.9 | already a dep; wire into library capture in a later phase |
| Region/window selection UI | existing native Win32 overlay | already built, keep |
| Global hotkeys | `tauri-plugin-global-shortcut` (official v2) + npm plugin | **new dep** |
| Clipboard images | existing DIB clipboard writers | keep (no `arboard` needed) |
| Thumbnails / PNG encode | `image` crate | already a dep |
| Reveal in Explorer | `tauri-plugin-opener` | already a dep |
| Annotation editor (Phase 2) | browser Canvas 2D | shipped without another rendering dependency |
| Batch resize/convert (Phase 2) | backend `image` crate | serialized with the screenshot filesystem command family |
| Folder watching (optional, later) | `notify` crate | deferred; v1 refreshes on focus/capture events |

## Phases

**Phase 1 — Module MVP (this plan's implementation target)**
Module shell + Library (3 view modes, sort by date, open/copy/rename/delete/
clear/reveal), capture region/window/fullscreen buttons, thumbnail-aware
listing, tray capture items, global shortcuts, Settings section
(folder/format/shortcuts), full i18n/manual/tutorial compliance.
Success criteria: capture from button, tray (window hidden), and hotkey all
land in the Library with a Status Bar notice; 500-image folder lists smoothly;
`npm run check`, `npm run build`, `cargo check`, `cargo test` green.

**Phase 2 — Editing & polish (partially shipped)**
The library now supports persisted sort/group controls (defaulting to Date
descending and Date grouping), multi-selection, non-destructive batch resize
and PNG/JPEG conversion, capture delay presets, and a unified viewer/editor
with Fit/zoom plus stage-wide crop (including transparent padding beyond the source image), freehand pencil strokes, arrows, rectangles, ellipses, text, and mosaic regions. Highlight,
after-capture editor automation, and non-destructive editor drafts that survive
capture-driven editor switching and app restarts are shipped. Drafts retain
editable crop and annotation layers beside the library without modifying the
original image until Save. Per-monitor fullscreen capture and filename
patterns remain later work.

**Phase 3 — Parity stretch (each needs its own design pass)**
macOS/Linux capture via `xcap`, scrolling capture, OCR, screen recording
(GIF/MP4), upload/share targets. Explicitly out of scope for now.

## Deferred

- AI Assistant read access to the Library (e.g. "attach my last screenshot")
  is explicitly deferred — not part of any planned phase until requested.

All open questions from the initial draft (module tier, rail visibility,
default shortcuts, default format) are resolved — see "Scope decisions" above.

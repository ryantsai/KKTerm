# Screenshots Module — Plan

Status: **Phase 1 implemented.** This document was the working plan for the
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
- `src/modules/workspace/ScreenshotMenu.tsx` — per-Pane copy-to-clipboard menu
  (stays as-is; it is a Workspace affordance, not part of this Module).
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
- `ModuleHeader` layout: identity tile + title on the left; view-mode switcher,
  sort toggle, and capture actions on the right.

### Library

- Three view modes, persisted in `localStorage`:
  - **Thumbnails** (default) — responsive card grid of image previews with
    filename + relative date.
  - **List** — compact rows: small thumbnail, filename, date.
  - **Details** — table: thumbnail, filename, kind (Region / Window /
    Fullscreen), dimensions, size, date.
- Uses the existing pagination (`offset`/`limit`, "Load more" or
  infinite scroll) — no new virtualization dependency.
- Row/card actions (native context menu via `src/lib/nativeContextMenu.ts`):
  Open (viewer), Copy to clipboard, Open in default app, Reveal in
  Explorer/Finder, Rename, Delete. Toolbar: Clear all (through `ConfirmSheet`),
  Open folder, Refresh.
- Click opens a full-size viewer overlay (dialog primitives; zoom-to-fit,
  prev/next, copy, delete). Reuse the Document Connection image-viewer pieces
  where practical rather than building a new viewer.
- Empty state doubles as onboarding: explains capture buttons, tray items, and
  hotkeys.

### Capture actions

Buttons in the Module header (and mirrored in tray + hotkeys):

- **Capture region** — interactive region overlay.
- **Capture window** — interactive window picker.
- **Capture full screen** — all monitors.
- Each returns the saved `StoredScreenshot`; the Library prepends it,
  flash-highlights it, and a Status Bar notice confirms
  (`showStatusBarNotice`, per the notification invariant).
- Optional **capture delay** (0/2/5/10 s) as a small dropdown next to the
  capture buttons (simple `setTimeout` before invoking; ShareX/PicPick parity).

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
  with per-shortcut enable toggles and conflict errors surfaced in Settings.
  Handlers share the tray code path (work while hidden to tray).

### Settings

New **Settings → Screenshots** section (Settings Sidebar entry):

- Library folder (existing `folderPath`, folder picker via dialog plugin).
- Image format: **PNG (default)** or JPEG with a quality slider. Stored in
  `ScreenshotSettings` as optional serde-defaulted fields (no SQLite schema
  migration — screenshot settings are settings-storage JSON). Existing JPEG
  files keep listing/opening normally; the format only affects new captures.
- After-capture behavior checkboxes: Save to library (always on in v1),
  Copy to clipboard, Open viewer.
- Global shortcut editors + enable toggles.
- The existing DirectX capture toggle stays in General (it is shared with the
  assistant capture path); the Screenshots section links to it.

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
2. **PNG format + quality.** Extend `save_dib_to_library` and
   `ScreenshotSettings` (`format: "png" | "jpeg"`, serde default `png`;
   `jpegQuality` used only for JPEG). `image` already has the `png` feature
   enabled. File naming becomes `KKTerm-<kind>-<millis>.<ext>`.
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
- `LibraryView.tsx` — thumbnails/list/details rendering + pagination.
- `ScreenshotViewer.tsx` — full-size viewer dialog.
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
- **Dialogs/overlays**: viewer + confirm dialogs built from `src/app/ui/dialog`
  primitives, portal to `document.body`; ConfirmSheet for Clear all; context
  menus via `nativeContextMenu.ts` (the Module never overlaps RDP/URL native
  surfaces, but the shared primitives keep it safe anyway).
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
| Annotation editor (Phase 2) | `konva` | already a dep (Dashboard) |
| Client-side resize (Phase 2) | `pica` | already a dep |
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

**Phase 2 — Editing & polish**
Konva-based annotate/crop editor (arrows, rects, text, highlight, blur),
after-capture action pipeline (auto-copy, open editor), capture delay presets,
per-monitor fullscreen capture, filename pattern setting.

**Phase 3 — Parity stretch (each needs its own design pass)**
macOS/Linux capture via `xcap`, scrolling capture, OCR, screen recording
(GIF/MP4), upload/share targets. Explicitly out of scope for now.

## Deferred

- AI Assistant read access to the Library (e.g. "attach my last screenshot")
  is explicitly deferred — not part of any planned phase until requested.

All open questions from the initial draft (module tier, rail visibility,
default shortcuts, default format) are resolved — see "Scope decisions" above.

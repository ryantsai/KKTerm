# Universal Document & Light Editor — Feature Analysis

Status: Draft for analysis group · Author: feature analysis pass · Date: 2026-06-17

## 1. Goal

Add a new Connection type that opens a **document viewer / light editor**. The user
adds the Connection, picks a file, and a viewer/editor surface opens in the
Workspace Canvas. It should cover a wide range of common file types (plain text,
CSV, structured data, images, documents, and some binary formats) and offer
**dedicated modes** for specific types — most importantly a pretty-printed,
searchable, filterable **log viewer**.

The two governing priorities from the request:

1. **Priority 1 — No bloat.** Prefer file types we can support with what is
   *already bundled* (Rust crates already in `src-tauri/Cargo.toml`, NPM
   packages already in `package.json`, or capabilities native to WebView2).
2. **Priority 2 — External deps on demand.** For file types that need a heavy or
   awkward-to-bundle dependency, do **not** bundle it. Use the **Installer
   Helper** to download/install the dependency at runtime, only when the user
   first opens that file type.

This document is analysis only. It proposes scope and an implementation shape; it
does not change behavior. Terminology that survives review must be added to
`CONTEXT.md` before code lands (see §7).

---

## 2. How this fits the existing architecture

The cheapest, most consistent way to ship this is to model it exactly like the
existing **File Explorer (`localFiles`)** Connection, which is already a
local-only, no-network Connection that reuses a shared workspace surface.

- **Connection type.** Add a new `ConnectionType` (working name `fileView`) to
  the union in `src/types.ts:3` and the Rust connection model
  (`src-tauri/src/storage/connections.rs`). It stores a durable file path plus
  an optional "forced viewer/mode" hint. It has **no host, no network Session,
  no transfer footer** — same shape rules as `localFiles` (see
  `docs/ARCHITECTURE.md` → Connection Model, and `CONTEXT.md` → File Explorer
  Connection).
- **Pane kind.** Add a `fileViewer` pane kind alongside
  `terminal | sftp | webview | remoteDesktop | ftp | localFiles`
  (`src/types.ts:674`). **This must be persisted and rehydrated from
  `pane.kind`, never re-derived from `connection.type`** — this is the same
  SFTP-vs-SSH invariant called out in `docs/ARCHITECTURE.md` and guarded by
  `tests/sftp-layout-pane-kind.test.ts`.
- **Workspace surface.** New
  `src/modules/workspace/connections/file-viewer/FileViewerWorkspace.tsx`,
  dispatched from `WorkspaceCanvas.tsx` like the other surfaces.
- **Two entry points.** (a) a saved `fileView` Connection that re-opens a known
  file, and (b) an **"Open in Viewer"** action added to the existing File
  Explorer / SFTP browser context menu, so the viewer is reachable while
  browsing without first creating a Connection. (b) reuses the same surface.
- **Backend boundary.** All file reads, sniffing, decompression, and decoding
  must run through `spawn_blocking` / `run_blocking_command` — the **no
  UI-thread blocking** invariant applies to file IO exactly as it does to
  Sessions and Install Helper work (`docs/ARCHITECTURE.md` → Backend Command
  Runtime Boundaries). Large files must be read in bounded chunks, not slurped.
- **Lifecycle.** The file path is durable Connection data; live editor/scroll
  state is Session/Pane state and must not be written back into the Connection
  model.

### Format → viewer registry

To keep the matrix maintainable, use a frontend **viewer registry** that maps a
detected format to a viewer component plus its capability flags (`readonly`,
`editable`, `needsExternalTool`, `maxInlineBytes`). This mirrors the existing
`builtInRegistry.ts` pattern for Dashboard widgets: adding a format = adding one
registry entry. **Type detection** is extension-first with a **magic-byte sniff
fallback**, reusing the content-sniff approach already in
`src-tauri/src/import.rs`.

---

## 3. Inventory: what we can already do with zero added size

This is the key asset. A large share of "universal viewer" scope is reachable
**without adding a single dependency**.

### Already-bundled NPM (frontend)

| Library (in `package.json`) | What it unlocks for the viewer |
| --- | --- |
| **CodeMirror 6** (`view`, `state`, `commands`, `search`, `autocomplete`, `language`, `lang-markdown`, `theme-one-dark`) | The core text/code viewer **and** light editor: line numbers, large-doc handling, find/replace, undo/redo, syntax highlighting, code folding, read-only mode |
| `prismjs` | Extra syntax highlighting (already used by the assistant markdown renderer) |
| `papaparse` | CSV/TSV parsing |
| `gridjs` | Tabular rendering (CSV/TSV/SQLite rows as a sortable grid) |
| `js-yaml` | YAML parse/validate |
| `marked` + `dompurify` | Markdown → **sanitized** HTML preview |
| `fflate` | gzip/zip decompression in JS (`.gz` logs, peek inside `.zip`) |
| `fuse.js` | Fuzzy filtering (log search/filter) |
| `ansi-to-html` | ANSI-colored logs → HTML (colored console/CI logs) |
| `dayjs` | Timestamp parsing/normalization for log lines |
| `jwt-decode` | Decode `.jwt` tokens |
| `chart.js` / `uplot` | Charting numeric CSV columns or log metrics over time |
| `diff-match-patch` | Diff/compare (Phase 3 editing) |
| `konva` / `pica` | Image crop/rotate/resize (Phase 3 image edits) |

### Already-bundled Rust crates (backend)

| Crate (in `Cargo.toml`) | What it unlocks |
| --- | --- |
| `serde_json` | JSON parse / pretty-print for large files server-side |
| `zip` | List and extract entries from `.zip` archives |
| `rusqlite` (bundled SQLite) | **Open `.sqlite`/`.db` read-only**, list tables, run read-only `SELECT` → a SQLite DB viewer at zero added size |
| `image` (`jpeg`, `png`) | Decode/thumbnail/metadata for JPEG/PNG (more formats available behind features, see Phase 2) |
| `sha2` | File hash / integrity panel |
| `scraper` | HTML parsing/outline |
| `tauri-plugin-fs` + `protocol-asset` | Scoped local file read and asset-URL rendering |

### Native to WebView2 (zero code, zero deps)

Images and media that the embedded browser renders directly via `<img>` /
`<video>` / `<audio>` from the asset protocol: **PNG, JPEG, GIF, WebP, SVG, BMP,
ICO, AVIF**, and **MP4/WebM/MP3/WAV/OGG** where the platform codec exists. For
these the viewer is essentially a thin, sandboxed media surface. (SVG must be
sanitized/sandboxed — it can carry script.)

---

## 4. Phase 1 (MVP) — bundled-only file types

Everything below ships with **no new dependency**. Grouped by viewer mode.

### A. Text & code (CodeMirror)
`.txt`, `.log` (raw), `.md` (raw + rendered), `.json`, `.yaml`/`.yml`, `.xml`,
`.toml`, `.ini`/`.conf`/`.env`/`.properties`, `.csv`/`.tsv` (raw), `.diff`/`.patch`,
and source code (`.js`, `.ts`, `.py`, `.rs`, `.sh`, `.sql`, `.html`, `.css`, …).
CodeMirror provides line numbers, search, folding, syntax highlighting, and a
read-only toggle. This single mode covers the long tail of "open any text file."

### B. Structured data (dedicated modes)
- **CSV/TSV** → `papaparse` + `gridjs` table (sort/filter), with a raw-text
  toggle. Numeric columns can offer a quick `chart.js`/`uplot` chart.
- **JSON** → pretty-print + collapsible tree; `serde_json` handles large files
  server-side before handing a projection to the UI.
- **YAML / TOML / XML** → highlighted text (CodeMirror); YAML additionally
  validated via `js-yaml`. (No TOML parser is bundled — display as text in MVP.)
- **Markdown** → `marked` + `dompurify` rendered preview with a source toggle.
- **`.ipynb`** → it is JSON; render cells + outputs from the JSON in MVP.

### C. Images & media
Render natively in WebView2 (see §3). `image` (Rust) supplies dimensions/EXIF
basics and thumbnails for JPEG/PNG. A simple zoom/fit/pan wrapper is all the UI
needed.

### D. Log viewer — the flagship dedicated mode
Layer a structured log mode on top of the text engine:
- **Decoding:** plain text, ANSI-colored (`ansi-to-html`), gzip `.gz` (`fflate`).
- **Parsers** (extension + content sniff): NDJSON / JSON-lines, syslog
  (RFC 3164/5424), Apache/nginx access logs (common/combined), `logfmt`
  (`key=value`), and a generic "timestamp + level + message" line parser using
  `dayjs` for the time column.
- **UX:** filterable/sortable table with **level coloring**, a **time column**,
  **fuzzy search** (`fuse.js`), **severity/level filters**, **time-range
  filtering**, and a **"follow / tail"** toggle for growing files (chunked
  backend reads, no UI-thread blocking).

### E. Archives (peek)
`.zip` (Rust `zip`) and `.gz` (`fflate`): list entries, then open one inner file
into the appropriate viewer. Reuses the SFTP/file-browser list UI pattern.

### F. SQLite databases
`.sqlite`/`.db`/`.sqlite3` via bundled `rusqlite` (read-only): list tables, view
rows in `gridjs`, run read-only `SELECT`. A genuine differentiator at zero cost.

### G. Binary / hex fallback
A custom **hex viewer** (offset / hex / ASCII columns, chunked reads, no deps)
as the catch-all for unknown or binary files — satisfies "even some binary
formats" and gives every file *some* viewer.

**Phase 1 implementation checklist**
- `ConnectionType` + Rust model + storage migration for `fileView` (store path +
  optional forced mode).
- `fileViewer` pane kind; persist/rehydrate via `pane.kind`; extend
  `tests/sftp-layout-pane-kind.test.ts`-style coverage.
- `FileViewerWorkspace.tsx` + dispatch in `WorkspaceCanvas.tsx`.
- Add-Connection dialog field surface with native file picker
  (`tauri-plugin-dialog`); "Open in Viewer" action in the file browser.
- Backend commands (all `spawn_blocking`): bounded/chunked read, type sniff, zip
  list/extract-one, sqlite tables/query, image metadata/thumbnail.
- Viewer registry + extension/magic-byte detection (reuse `import.rs` sniff).
- Connection icon mapping (`fileBrowserConnectionIcons.ts` pattern), i18n keys
  in `en.json` first, a manual chapter, and tutorial targets.

---

## 5. Phase 2 — external dependencies via Install Helper

For formats that need a heavy dependency, follow Priority 2: **don't bundle**.
The Install Helper already provides the exact machinery — pure-data recipe
providers (`winget`, `npm`, `uvPip`, `downloadInstaller`, `githubRelease`,
`windowsFeature`, `wslDistro`, `bundle`), a per-tool detection cache, app-local
install dirs under `%LOCALAPPDATA%\KKTerm\installer\`, streaming progress, and
honest UAC handling.

### Dependency-gate pattern
When a file's viewer declares `needsExternalTool`, the viewer:
1. Checks the Install Helper detection cache for the tool.
2. If missing, shows an **app-owned dialog** (built from `src/app/ui/dialog`
   primitives) offering "Install via Install Helper," using a Deep Link to that
   tool's row — no silent bundling, honest about UAC.
3. Once detected, a backend **conversion command** (background worker) runs the
   installed tool from its app-local/managed path, writes a viewable artifact to
   a temp file, and the viewer renders the result with an existing Phase 1
   viewer (PDF/PNG/HTML/text).

### Candidate tools (add as catalog entries)

| File types | External tool (provider) | Strategy |
| --- | --- | --- |
| **PDF** | `pdfium` (`githubRelease`, pdfium-binaries) **or** Poppler | Render pages → PNG, view as image stack. *(See open question Q1.)* |
| **DOCX/XLSX/PPTX/ODF** | LibreOffice (`winget`) — fidelity; or `pandoc` — lightweight DOCX/RTF→HTML | `soffice --headless --convert-to pdf/html`, then PDF/HTML viewer |
| **EVTX** (Windows Event Log) | `evtx_dump` (`githubRelease`) | Convert to JSON → **log viewer** |
| **7z / RAR / tar.xz** | 7-Zip (`winget`) | List/extract → archive peek |
| **RAW / HEIC / PSD / TIFF** | ImageMagick or libvips (`winget`) | Convert → PNG |
| **Unsupported video/audio codecs** (mkv, mov, flv) | **FFmpeg — already in the catalog** | `ffprobe` metadata + transcode/preview |
| **MOBI/AZW3 e-books** | Calibre `ebook-convert` (`winget`) | Convert → EPUB/HTML (EPUB itself is zip+HTML, doable in-bundle) |
| **pcap/pcapng** | tshark/Wireshark (`winget`) | Export → text/JSON → log viewer |

### Install Helper wiring
- Add the catalog entries above to `installer/catalog.v1.json` (FFmpeg exists).
- Conversion commands are background workers writing to temp; outputs are
  transient and not persisted (mirrors screenshot-capture handling).
- Detection reuses the existing per-tool cache; no new polling loops (respect the
  "no command-based polling" rule).

---

## 6. Phase 3 — editing enhancements

Phase 1 already ships **light editing for text/code** via CodeMirror (edit,
find/replace, undo/redo). Phase 3 hardens and broadens it.

**Safe-save pipeline (highest priority — correctness)**
- Atomic write (temp file + rename), **encoding** detection/preservation
  (UTF-8/UTF-16/BOM), **line-ending** preservation (CRLF/LF), large-file guard,
  external-change detection via mtime, optional backup-on-save. Never execute
  file contents; keep `dompurify`/sandbox on any rendered HTML/SVG/Markdown.

**Structured editors**
- **CSV grid editing**: editable cells, add/remove rows/columns (gridjs is
  display-only, so either an editable-grid layer or round-trip through CodeMirror
  text + re-parse — see open question Q2).
- **JSON/YAML**: structured edit with on-save validation (`serde_json` /
  `js-yaml`); optional schema checks.
- **Markdown**: split live-preview editor (`marked`).

**Comparison & history**
- Two-file or before/after **diff** using bundled `diff-match-patch`; inline diff
  while editing.

**Log enhancements (logs stay read-only)**
- Saved filters, bookmarks/annotations, and "export filtered subset" rather than
  in-place editing.

**Optional / advanced**
- Light image edits (crop/rotate/resize via `konva`/`pica`), hex **write** mode
  (gated, risky), multi-cursor and bracket matching (native CodeMirror).

---

## 7. Cross-cutting requirements & risks

- **Domain language.** Add a `CONTEXT.md` term before code — proposed **"File
  Viewer Connection"** (kind `fileView`): a durable Connection that opens a local
  file in a viewer/editor Pane, no network Session. *Avoid:* document, editor
  profile, file profile.
- **No UI-thread blocking.** Every read/sniff/decompress/decode/convert goes
  through `spawn_blocking`/`run_blocking_command`.
- **Large files.** Set per-viewer `maxInlineBytes`; above it, fall back to
  chunked/virtualized read-only or hex. CodeMirror degrades on very large docs.
- **Security.** Sanitize all rendered HTML/Markdown (`dompurify`); sandbox SVG
  and any HTML preview; never run file contents; scope `tauri-plugin-fs`.
- **i18n / Design Language / Manual.** All strings via i18n (en.json first);
  dialogs and the file picker built from `src/app/ui/dialog` primitives following
  the SFTP file-browser pattern in `docs/DESIGN_LANGUAGE.md`; add a manual
  chapter and tutorial targets (`npm run check` enforces tutorial mappings).
- **Connection vs Session.** Path is durable; editor/scroll/filter state is live
  Session state and stays out of the Connection model.

## 8. Open questions for the analysis group

- **Q1 — PDF strategy.** PDF is high-demand. Options: (a) external **pdfium via
  Install Helper** (keeps bundle small, true to Priority 2, but adds a
  first-open install step), or (b) bundle **pdf.js** as a deliberate exception
  (instant, offline, but meaningfully grows the frontend bundle). Recommendation:
  start with (a); revisit (b) if the install friction tests poorly.
- **Q2 — CSV editing.** Keep gridjs read-only and edit CSV via CodeMirror text
  round-trip (zero new deps), or add an editable-grid dependency for spreadsheet
  UX? Recommendation: text round-trip for Phase 3 MVP; reassess on demand.
- **Q3 — Connection granularity.** One Connection = one file (bookmark model,
  matches the request literally), versus a single "Document" Connection that
  opens a picker each time. Recommendation: support the per-file bookmark
  Connection **and** the browser "Open in Viewer" action; they share one surface.
- **Q4 — Platform scope.** Install Helper is Windows-only today. Phase 1
  (bundled) is cross-platform; Phase 2 external-tool conversions are initially
  Windows-only until the helper grows macOS/Linux providers — acceptable?
